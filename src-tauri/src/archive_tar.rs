//! TAR 스트림과 코덱만 소유. 진행 상태·충돌·최종 게시·정리는 호출 계층에서 처리.
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct Member {
    pub path: String,
    pub directory: bool,
    pub link: bool,
    pub size: u64,
}

fn cancelled(check: &dyn Fn() -> bool) -> io::Result<()> {
    if check() {
        Err(io::Error::other("operation_cancelled"))
    } else {
        Ok(())
    }
}

struct CheckedRead<'a, R> {
    inner: R,
    cancel: &'a dyn Fn() -> bool,
}
impl<R: Read> Read for CheckedRead<'_, R> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        cancelled(self.cancel)?;
        self.inner.read(bytes)
    }
}

fn reader<'a>(
    path: &Path,
    format: &str,
    cancel: &'a dyn Fn() -> bool,
) -> io::Result<Box<dyn Read + 'a>> {
    let file = CheckedRead {
        inner: File::open(path)?,
        cancel,
    };
    let decoded: Box<dyn Read + 'a> = match format {
        "tar" => Box::new(file),
        "tar.gz" => Box::new(flate2::read::MultiGzDecoder::new(file)),
        "tar.zst" => Box::new(zstd::stream::read::Decoder::new(file)?),
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "unsupported tar format",
            ))
        }
    };
    Ok(Box::new(CheckedRead {
        inner: decoded,
        cancel,
    }))
}

pub(crate) fn list(
    path: &Path,
    format: &str,
    cancel: &dyn Fn() -> bool,
) -> io::Result<Vec<Member>> {
    let mut archive = tar::Archive::new(reader(path, format, cancel)?);
    let mut members = Vec::new();
    for entry in archive.entries()? {
        cancelled(cancel)?;
        let entry = entry?;
        let kind = entry.header().entry_type();
        members.push(Member {
            path: entry.path()?.to_string_lossy().replace('\\', "/"),
            directory: kind.is_dir(),
            link: !kind.is_file() && !kind.is_dir(),
            size: entry.size(),
        });
    }
    Ok(members)
}

enum Output {
    Tar(File),
    Gzip(flate2::write::GzEncoder<File>),
    Zstd(zstd::stream::write::Encoder<'static, File>),
}
impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        match self {
            Self::Tar(w) => w.write(bytes),
            Self::Gzip(w) => w.write(bytes),
            Self::Zstd(w) => w.write(bytes),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Self::Tar(w) => w.flush(),
            Self::Gzip(w) => w.flush(),
            Self::Zstd(w) => w.flush(),
        }
    }
}
impl Output {
    fn finish(self) -> io::Result<()> {
        let file = match self {
            Self::Tar(file) => file,
            Self::Gzip(w) => w.finish()?,
            Self::Zstd(w) => w.finish()?,
        };
        file.sync_all()
    }
}

pub(crate) fn create(
    target: &Path,
    sources: &[PathBuf],
    format: &str,
    cancel: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(u64, u64),
) -> io::Result<()> {
    cancelled(cancel)?;
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    let writer = match format {
        "tar" => Output::Tar(file),
        "tar.gz" => Output::Gzip(flate2::write::GzEncoder::new(
            file,
            flate2::Compression::default(),
        )),
        "tar.zst" => Output::Zstd(zstd::stream::write::Encoder::new(file, 3)?),
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "unsupported tar format",
            ))
        }
    };
    let mut builder = tar::Builder::new(writer);
    let mut counters = (0, 0);
    for source in sources {
        let name = source
            .file_name()
            .ok_or_else(|| io::Error::other("missing archive member name"))?;
        append(
            &mut builder,
            source,
            Path::new(name),
            cancel,
            progress,
            &mut counters,
        )?;
    }
    cancelled(cancel)?;
    builder.into_inner()?.finish()
}

fn append(
    builder: &mut tar::Builder<Output>,
    source: &Path,
    name: &Path,
    cancel: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(u64, u64),
    counters: &mut (u64, u64),
) -> io::Result<()> {
    cancelled(cancel)?;
    let metadata = fs::symlink_metadata(source)?;
    crate::platform::validate_reparse_point(source, &metadata)
        .map_err(|e| io::Error::other(e.code))?;
    if metadata.is_dir() {
        builder.append_dir(name, source)?;
        counters.0 += 1;
        progress(counters.0, counters.1);
        for child in fs::read_dir(source)? {
            let child = child?;
            append(
                builder,
                &child.path(),
                &name.join(child.file_name()),
                cancel,
                progress,
                counters,
            )?;
        }
    } else if metadata.is_file() {
        let mut header = tar::Header::new_gnu();
        header.set_metadata(&metadata);
        header.set_cksum();
        struct ProgressRead<'a> {
            file: File,
            cancel: &'a dyn Fn() -> bool,
            progress: &'a mut dyn FnMut(u64, u64),
            counters: &'a mut (u64, u64),
        }
        impl Read for ProgressRead<'_> {
            fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
                cancelled(self.cancel)?;
                let count = self.file.read(bytes)?;
                self.counters.1 += count as u64;
                (self.progress)(self.counters.0, self.counters.1);
                Ok(count)
            }
        }
        let input = ProgressRead {
            file: File::open(source)?,
            cancel,
            progress,
            counters,
        };
        builder.append_data(&mut header, name, input)?;
        counters.0 += 1;
        progress(counters.0, counters.1);
    } else {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "archive special file",
        ));
    }
    Ok(())
}

pub(crate) fn extract(
    source: &Path,
    format: &str,
    target: &Path,
    selected: Option<&[String]>,
    cancel: &dyn Fn() -> bool,
) -> io::Result<()> {
    let selected = selected.map(|paths| paths.iter().map(|p| normalize(p)).collect::<HashSet<_>>());
    let mut archive = tar::Archive::new(reader(source, format, cancel)?);
    for entry in archive.entries()? {
        cancelled(cancel)?;
        let mut entry = entry?;
        let path = entry.path()?.to_string_lossy().replace('\\', "/");
        let kind = entry.header().entry_type();
        if crate::archive_provider::unsafe_entry(&path, cfg!(windows))
            || (!kind.is_file() && !kind.is_dir())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unsafe_archive_entry",
            ));
        }
        if selected
            .as_ref()
            .is_some_and(|paths| !paths.contains(&normalize(&path)))
        {
            continue;
        }
        if !entry.unpack_in(target)? {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unsafe_archive_entry",
            ));
        }
    }
    Ok(())
}

fn normalize(path: &str) -> String {
    path.split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::{create, extract, list};
    use std::{fs, fs::File, path::PathBuf};
    use std::cell::Cell;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "boksldir-tar-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn tar_codecs_preserve_names_and_extract_only_selected_members() {
        let f = Fixture::new();
        let folder = f.0.join("한글 폴더");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join(" leading.txt"), "selected").unwrap();
        fs::write(folder.join("other.txt"), "not selected").unwrap();
        for format in ["tar", "tar.gz", "tar.zst"] {
            let archive = f.0.join(format!("sample.{format}"));
            let mut updates = Vec::new();
            create(
                &archive,
                &[folder.clone()],
                format,
                &|| false,
                &mut |files, bytes| updates.push((files, bytes)),
            )
            .unwrap();
            assert_eq!(updates.last(), Some(&(3, 20)));
            let members = list(&archive, format, &|| false).unwrap();
            assert!(members
                .iter()
                .any(|m| m.path == "한글 폴더/ leading.txt" && m.size == 8));
            let output = f.0.join(format!("out-{format}"));
            fs::create_dir(&output).unwrap();
            extract(
                &archive,
                format,
                &output,
                Some(&["한글 폴더/ leading.txt".into()]),
                &|| false,
            )
            .unwrap();
            assert_eq!(
                fs::read_to_string(output.join("한글 폴더/ leading.txt")).unwrap(),
                "selected"
            );
            assert!(!output.join("한글 폴더/other.txt").exists());
            #[cfg(target_os = "macos")]
            {
                let listed = std::process::Command::new("/usr/bin/tar")
                    .arg("-tf")
                    .arg(&archive)
                    .output()
                    .unwrap();
                assert!(listed.status.success(), "{format}: {:?}", listed.stderr);
                assert!(String::from_utf8_lossy(&listed.stdout).contains("한글 폴더/ leading.txt"));
            }
        }
    }

    #[test]
    fn tar_creation_and_decoder_observe_cancellation_inside_large_member() {
        let f = Fixture::new();
        let source = f.0.join("large");
        fs::write(&source, vec![42; 4 * 1024 * 1024]).unwrap();
        for format in ["tar", "tar.gz", "tar.zst"] {
            let archive = f.0.join(format!("cancel.{format}"));
            let stop = Cell::new(false);
            let bytes_read = Cell::new(0);
            let error = create(
                &archive,
                &[source.clone()],
                format,
                &|| stop.get(),
                &mut |_, bytes| {
                    bytes_read.set(bytes);
                    if bytes >= 64 * 1024 {
                        stop.set(true);
                    }
                },
            )
            .unwrap_err();
            assert!(error.to_string().contains("operation_cancelled"));
            assert!(bytes_read.get() < 4 * 1024 * 1024);
            fs::remove_file(&archive).unwrap();
            create(
                &archive,
                &[source.clone()],
                format,
                &|| false,
                &mut |_, _| {},
            )
            .unwrap();
            let reads = Cell::new(0);
            let result = list(&archive, format, &|| {
                reads.set(reads.get() + 1);
                reads.get() > 5
            });
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("operation_cancelled"));
        }
    }

    #[test]
    fn tar_rejects_traversal_links_and_corrupt_streams() {
        let f = Fixture::new();
        for (index, name) in ["../escaped", "/absolute"].iter().enumerate() {
            let archive = f.0.join(format!("bad-{index}.tar"));
            let mut header = tar::Header::new_gnu();
            header.as_mut_bytes()[..name.len()].copy_from_slice(name.as_bytes());
            header.set_size(1);
            header.set_mode(0o644);
            header.set_cksum();
            let mut builder = tar::Builder::new(File::create(&archive).unwrap());
            builder.append(&header, &b"x"[..]).unwrap();
            builder.finish().unwrap();
            drop(builder);
            let output = f.0.join(format!("out-{index}"));
            fs::create_dir(&output).unwrap();
            assert!(extract(&archive, "tar", &output, None, &|| false).is_err());
            assert_eq!(fs::read_dir(output).unwrap().count(), 0);
        }
        let archive = f.0.join("link.tar");
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        let mut builder = tar::Builder::new(File::create(&archive).unwrap());
        builder
            .append_link(&mut header, "link", "../outside")
            .unwrap();
        builder.finish().unwrap();
        drop(builder);
        assert!(list(&archive, "tar", &|| false).unwrap()[0].link);
        assert!(extract(&archive, "tar", &f.0.join("out"), None, &|| false).is_err());
        fs::write(&archive, "corrupt").unwrap();
        for format in ["tar", "tar.gz", "tar.zst"] {
            assert!(list(&archive, format, &|| false).is_err());
        }
        assert!(!f.0.join("outside").exists());
    }
}
