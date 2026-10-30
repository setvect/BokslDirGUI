use crate::contracts::{ImageMetadata, ImageMetadataField};
use exif::{In, Tag, Value};
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

// 이미지 전체 디코딩·대형 TIFF 전체 읽기 없이 읽기량과 응답 크기를 제한한다.
const READ_LIMIT: u64 = 16 * 1024 * 1024;
const FIELD_LIMIT: usize = 128;
const VALUE_LIMIT: usize = 512;

pub(crate) fn read_image_metadata(path: &Path) -> Option<ImageMetadata> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "jpg"
            | "jpeg"
            | "tif"
            | "tiff"
            | "dng"
            | "heic"
            | "heif"
            | "avif"
            | "png"
            | "webp"
            | "gif"
            | "bmp"
    ) {
        return None;
    }
    let mut result = ImageMetadata {
        width: None,
        height: None,
        exif_status: "unreadable".into(),
        fields: Vec::new(),
        truncated: false,
    };
    let file = File::open(path).and_then(|file| {
        if !file.metadata()?.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "not a file",
            ));
        }
        Ok(file)
    });
    let Ok(file) = file else {
        return Some(result);
    };
    let mut reader = BufReader::new(BoundedReader {
        inner: file,
        remaining: READ_LIMIT,
    });
    if let Ok(size) = imagesize::reader_size(&mut reader) {
        result.width = Some(size.width);
        result.height = Some(size.height);
    }
    if matches!(extension.as_str(), "gif" | "bmp") {
        if result.width.is_some() {
            result.exif_status = "absent".into();
        }
        return Some(result);
    }
    if reader.seek(SeekFrom::Start(0)).is_err() {
        return Some(result);
    }
    match exif::Reader::new().read_from_container(&mut reader) {
        Ok(exif) => {
            result.width = result
                .width
                .or_else(|| dimension(&exif, Tag::PixelXDimension, Tag::ImageWidth));
            result.height = result
                .height
                .or_else(|| dimension(&exif, Tag::PixelYDimension, Tag::ImageLength));
            for field in exif.fields().filter(|field| field.ifd_num == In::PRIMARY) {
                // MakerNote 같은 바이너리는 제외하고 읽을 수 있는 공통 태그만 표시한다.
                if matches!(field.value, Value::Undefined(..) | Value::Unknown(..)) {
                    continue;
                }
                if result.fields.len() == FIELD_LIMIT {
                    result.truncated = true;
                    break;
                }
                let value = field.display_value().with_unit(&exif).to_string();
                let mut bounded: String = value.chars().take(VALUE_LIMIT).collect();
                if value.chars().count() > VALUE_LIMIT {
                    bounded.push('…');
                    result.truncated = true;
                }
                result.fields.push(ImageMetadataField {
                    key: field.tag.to_string(),
                    value: bounded,
                });
            }
            result.exif_status = if result.fields.is_empty() {
                "absent"
            } else {
                "present"
            }
            .into();
        }
        Err(_) if reader.get_ref().remaining == 0 => result.exif_status = "limited".into(),
        Err(exif::Error::NotFound(_)) => result.exif_status = "absent".into(),
        Err(_) => {}
    }
    Some(result)
}

// JPEG/HEIF 등의 픽셀 본문은 seek로 건너뛰고 실제 읽은 바이트만 제한한다.
struct BoundedReader<R> {
    inner: R,
    remaining: u64,
}

impl<R: Read> Read for BoundedReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        if self.remaining == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "image metadata read limit",
            ));
        }
        let limit = buffer.len().min(self.remaining as usize);
        let count = self.inner.read(&mut buffer[..limit])?;
        self.remaining -= count as u64;
        Ok(count)
    }
}

impl<R: Seek> Seek for BoundedReader<R> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
}

fn dimension(exif: &exif::Exif, preferred: Tag, fallback: Tag) -> Option<usize> {
    exif.get_field(preferred, In::PRIMARY)
        .or_else(|| exif.get_field(fallback, In::PRIMARY))
        .and_then(|field| field.value.get_uint(0))
        .map(|value| value as usize)
}

#[cfg(test)]
mod tests {
    use super::{read_image_metadata, READ_LIMIT, VALUE_LIMIT};
    use exif::{experimental::Writer, Field, In, Rational, Tag, Value};
    use std::fs::{self, File};
    use std::io::Cursor;
    use std::path::PathBuf;

    struct Fixture(PathBuf, #[allow(dead_code)] crate::test_util::TempDir); // 삭제는 TempDir Drop이 담당
    impl Fixture {
        fn new() -> Self {
            let dir = crate::test_util::TempDir::new("photo");
            Self(dir.path().to_path_buf(), dir)
        }
        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    fn photo_fields() -> Vec<Field> {
        vec![
            (Tag::Make, Value::Ascii(vec![b"Test Camera".to_vec()])),
            (Tag::Model, Value::Ascii(vec![b"Camera 1".to_vec()])),
            (Tag::LensModel, Value::Ascii(vec![b"50mm F2".to_vec()])),
            (
                Tag::DateTimeOriginal,
                Value::Ascii(vec![b"2026:10:11 13:14:15".to_vec()]),
            ),
            (
                Tag::OffsetTimeOriginal,
                Value::Ascii(vec![b"+09:00".to_vec()]),
            ),
            (
                Tag::ExposureTime,
                Value::Rational(vec![Rational { num: 1, denom: 250 }]),
            ),
            (
                Tag::FNumber,
                Value::Rational(vec![Rational { num: 28, denom: 10 }]),
            ),
            (Tag::PhotographicSensitivity, Value::Short(vec![400])),
            (Tag::PixelXDimension, Value::Long(vec![6000])),
            (Tag::PixelYDimension, Value::Long(vec![4000])),
            (Tag::GPSLatitudeRef, Value::Ascii(vec![b"N".to_vec()])),
            (
                Tag::GPSLatitude,
                Value::Rational(vec![
                    Rational { num: 37, denom: 1 },
                    Rational { num: 30, denom: 1 },
                    Rational { num: 0, denom: 1 },
                ]),
            ),
            (
                Tag::Copyright,
                Value::Ascii(vec![b"Example photographer".to_vec()]),
            ),
        ]
        .into_iter()
        .map(|(tag, value)| Field {
            tag,
            value,
            ifd_num: In::PRIMARY,
        })
        .collect()
    }

    fn tiff(fields: &[Field]) -> Vec<u8> {
        let mut writer = Writer::new();
        for field in fields {
            writer.push_field(field);
        }
        let mut bytes = Cursor::new(Vec::new());
        writer.write(&mut bytes, true).unwrap();
        bytes.into_inner()
    }

    fn jpeg(fields: &[Field]) -> Vec<u8> {
        let tiff = tiff(fields);
        let mut bytes = vec![0xff, 0xd8, 0xff, 0xe1];
        bytes.extend_from_slice(&((tiff.len() + 8) as u16).to_be_bytes());
        bytes.extend_from_slice(b"Exif\0\0");
        bytes.extend_from_slice(&tiff);
        bytes.extend_from_slice(&[0xff, 0xd9]);
        bytes
    }

    #[test]
    fn photo_metadata_reads_camera_exposure_gps_and_capture_time_without_modifying_file() {
        let fixture = Fixture::new();
        let bytes = jpeg(&photo_fields());
        let path = fixture.write("photo.JPG", &bytes);
        let metadata = crate::navigation::get_metadata(path.to_str().unwrap()).unwrap();
        let image = metadata.image_metadata.as_ref().unwrap();
        assert_eq!((image.width, image.height), (Some(6000), Some(4000)));
        assert_eq!(image.exif_status, "present");
        for (key, expected) in [
            ("Make", "Test Camera"),
            ("Model", "Camera 1"),
            ("LensModel", "50mm F2"),
            ("ExposureTime", "1/250"),
            ("FNumber", "2.8"),
            ("PhotographicSensitivity", "400"),
            ("DateTimeOriginal", "2026-10-11 13:14:15"),
            ("OffsetTimeOriginal", "+09:00"),
            ("GPSLatitude", "37"),
            ("Copyright", "Example photographer"),
        ] {
            assert!(
                image
                    .fields
                    .iter()
                    .any(|field| field.key == key && field.value.contains(expected)),
                "missing {key}: {:?}",
                image.fields
            );
        }
        let json = serde_json::to_value(metadata).unwrap();
        assert_eq!(json["imageMetadata"]["exifStatus"], "present");
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn photo_metadata_remains_available_above_preview_and_metadata_read_limits() {
        let fixture = Fixture::new();
        let path = fixture.write("large.jpg", &jpeg(&photo_fields()));
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(READ_LIMIT + 4096)
            .unwrap();
        assert_eq!(
            crate::preview::preview_file(path.to_str().unwrap().to_string(), None)
                .unwrap()
                .kind,
            "tooLarge"
        );
        assert_eq!(read_image_metadata(&path).unwrap().exif_status, "present");
    }

    #[test]
    fn photo_metadata_distinguishes_absent_corrupt_and_read_limit() {
        let fixture = Fixture::new();
        let empty = fixture.write("empty.jpg", &[0xff, 0xd8, 0xff, 0xd9]);
        assert_eq!(read_image_metadata(&empty).unwrap().exif_status, "absent");
        let broken = fixture.write("broken.jpg", b"not a jpeg");
        let metadata = crate::navigation::get_metadata(broken.to_str().unwrap()).unwrap();
        assert_eq!(metadata.entry.size_bytes, Some(10));
        assert_eq!(metadata.image_metadata.unwrap().exif_status, "unreadable");
        let large_tiff = fixture.write("large.tiff", &tiff(&photo_fields()));
        File::options()
            .write(true)
            .open(&large_tiff)
            .unwrap()
            .set_len(READ_LIMIT + 1)
            .unwrap();
        assert_eq!(
            read_image_metadata(&large_tiff).unwrap().exif_status,
            "limited"
        );
        assert!(read_image_metadata(&fixture.write("notes.txt", b"hello")).is_none());
    }

    #[test]
    fn photo_metadata_reads_png_dimensions_without_exif() {
        let fixture = Fixture::new();
        // 1×1 PNG, EXIF 없는 독립적인 이미지 헤더 fixture.
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89\0\0\0\0IEND\xaeB`\x82";
        let image = read_image_metadata(&fixture.write("image.png", png)).unwrap();
        assert_eq!((image.width, image.height), (Some(1), Some(1)));
        assert_eq!(image.exif_status, "absent");
    }

    #[test]
    fn photo_metadata_bounds_values_and_ignores_thumbnail_tags() {
        let fixture = Fixture::new();
        let mut fields = photo_fields();
        fields.push(Field {
            tag: Tag::ImageDescription,
            ifd_num: In::PRIMARY,
            value: Value::Ascii(vec![vec![b'x'; 2000]]),
        });
        fields.push(Field {
            tag: Tag::Model,
            ifd_num: In::THUMBNAIL,
            value: Value::Ascii(vec![b"thumbnail only".to_vec()]),
        });
        let image = read_image_metadata(&fixture.write("image.tiff", &tiff(&fields))).unwrap();
        assert!(image.truncated);
        assert!(image
            .fields
            .iter()
            .all(|field| field.value.chars().count() <= VALUE_LIMIT + 1));
        assert!(!image
            .fields
            .iter()
            .any(|field| field.value.contains("thumbnail only")));
    }
}
