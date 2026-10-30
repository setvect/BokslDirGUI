use crate::contracts::{AppError, CommandResult, RenameItem, RenamePreview, RenameRules};
use crate::filesystem::map_io_error;
use crate::mutation::{target_conflicts, validate_child_name};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};


pub(crate) fn preview(
    sources: Vec<String>,
    rules: RenameRules,
) -> CommandResult<Vec<RenamePreview>> {
    if sources.is_empty()
        || sources.len() > 10_000
        || rules.padding > 9
        || rules.start > 1_000_000_000
    {
        return Err(invalid(None));
    }
    let mut rows = Vec::new();
    for (index, raw) in sources.iter().enumerate() {
        let source = source_path(raw)?;
        let metadata = fs::symlink_metadata(&source).map_err(|e| map_io_error(e, Some(&source)))?;
        let name = source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| invalid(Some(&source)))?;
        let split = if rules.preserve_extension && !metadata.is_dir() {
            name.rfind('.').filter(|i| *i > 0)
        } else {
            None
        };
        let (stem, extension) = split
            .map(|i| (&name[..i], &name[i..]))
            .unwrap_or((name, ""));
        let replaced = if rules.find.is_empty() {
            stem.to_string()
        } else {
            stem.replace(&rules.find, &rules.replacement)
        };
        let number = if rules.numbering {
            format!(
                "_{:0width$}",
                rules.start + index as u64,
                width = rules.padding
            )
        } else {
            String::new()
        };
        let new_name = format!("{}{replaced}{number}{extension}", rules.prefix);
        rows.push(RenamePreview {
            changed: new_name != name,
            item: RenameItem {
                source: source.to_string_lossy().into_owned(),
                new_name,
                stamp: stamp(&metadata, &source)?,
            },
            error: None,
        });
    }
    let items: Vec<_> = rows.iter().map(|row| row.item.clone()).collect();
    let errors = plan_errors(&items);
    for (row, error) in rows.iter_mut().zip(errors) {
        row.error = error;
    }
    Ok(rows)
}

pub(crate) fn validate_plan(items: &[RenameItem]) -> CommandResult<()> {
    if items.is_empty() || items.len() > 10_000 {
        return Err(invalid(None));
    }
    if let Some(error) = plan_errors(items).into_iter().flatten().next() {
        return Err(error);
    }
    Ok(())
}
fn plan_errors(items: &[RenameItem]) -> Vec<Option<AppError>> {
    let mut targets = HashSet::new();
    let mut sources = HashSet::new();
    let source_paths: HashSet<_> = items
        .iter()
        .filter_map(|item| source_path(&item.source).ok())
        .collect();
    items
        .iter()
        .map(|item| {
            let validate = || -> CommandResult<()> {
                let source = source_path(&item.source)?;
                validate_child_name(&item.new_name, Some(&source))?;
                let target = source.with_file_name(&item.new_name);
                let metadata = crate::platform::entry_metadata(&source)?;
                if stamp(&metadata, &source)? != item.stamp {
                    return Err(AppError::new(
                        "source_changed",
                        "errors.renameSourceChanged",
                        Some(&source),
                        true,
                    ));
                }
                if target_conflicts(&source, &target) {
                    return Err(AppError::new(
                        "already_exists",
                        "errors.alreadyExists",
                        Some(&target),
                        true,
                    ));
                }
                if source
                    .ancestors()
                    .skip(1)
                    .any(|ancestor| source_paths.contains(ancestor))
                {
                    return Err(AppError::new(
                        "invalid_path",
                        "errors.renameNestedSources",
                        Some(&source),
                        true,
                    ));
                }
                Ok(())
            };
            if let Err(error) = validate() {
                return Some(error);
            }
            let target = Path::new(&item.source)
                .with_file_name(&item.new_name)
                .to_string_lossy()
                .into_owned();
            // 대소문자를 구분하지 않는 볼륨에서 계획 내부의 충돌을 실행 전에 보수적으로 차단.
            #[cfg(target_os = "macos")]
            let key = objc2_foundation::NSString::from_str(&target)
                .decomposedStringWithCanonicalMapping()
                .to_string()
                .to_lowercase();
            #[cfg(target_os = "windows")]
            let key = target.to_lowercase();
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let key = target;
            if !targets.insert(key) || !sources.insert(item.source.clone()) {
                return Some(AppError::new(
                    "already_exists",
                    "errors.renameDuplicate",
                    Some(Path::new(&item.source)),
                    true,
                ));
            }
            None
        })
        .collect()
}

fn source_path(raw: &str) -> CommandResult<PathBuf> {
    let raw = Path::new(raw);
    crate::platform::validate_path_input(raw)?;
    if !raw.is_absolute() {
        return Err(invalid(Some(raw)));
    }
    let name = raw
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| invalid(Some(raw)))?;
    let parent = raw
        .parent()
        .ok_or_else(|| invalid(Some(raw)))?
        .canonicalize()
        .map_err(|e| map_io_error(e, Some(raw)))?;
    Ok(parent.join(name))
}
fn stamp(metadata: &fs::Metadata, _path: &Path) -> CommandResult<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(format!(
            "{}:{}:{}:{}:{}",
            metadata.dev(),
            metadata.ino(),
            metadata.len(),
            metadata.mtime(),
            metadata.mtime_nsec()
        ))
    }
    #[cfg(windows)]
    {
        Ok(format!("{}:{:?}:{}", crate::platform::entry_identity(_path)?, metadata.modified(), metadata.len()))
    }
    #[cfg(not(any(unix, windows)))]
    {
        Ok(format!(
            "{:?}:{:?}:{}",
            metadata.created(),
            metadata.modified(),
            metadata.len()
        ))
    }
}
fn invalid(path: Option<&Path>) -> AppError {
    AppError::new("invalid_name", "errors.invalidName", path, true)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{preview, validate_plan, RenameRules};
    use std::fs;
    pub(crate) fn rules() -> RenameRules {
        RenameRules {
            find: "old".into(),
            replacement: "new".into(),
            prefix: "접두_".into(),
            numbering: true,
            start: 1,
            padding: 3,
            preserve_extension: true,
        }
    }
    #[test]
    fn preview_checks_collisions_names_and_changed_sources_without_mutation() {
        let temp = crate::test_util::TempDir::new("bulk-preview");
        let root = temp.path().to_path_buf();
        let file = root.join("old.json");
        fs::write(&file, "original").unwrap();
        let sources = vec![file.to_string_lossy().into_owned()];
        let rows = preview(sources.clone(), rules()).unwrap();
        assert_eq!(rows[0].item.new_name, "접두_new_001.json");
        assert!(rows[0].error.is_none());
        assert!(file.exists());
        let mut invalid_rule = rules();
        invalid_rule.prefix = "../".into();
        assert!(preview(sources.clone(), invalid_rule).unwrap()[0]
            .error
            .is_some());
        fs::write(root.join("접두_new_001.json"), "existing").unwrap();
        assert!(preview(sources.clone(), rules()).unwrap()[0]
            .error
            .is_some());
        fs::remove_file(root.join("접두_new_001.json")).unwrap();
        fs::write(&file, "changed contents").unwrap();
        assert_eq!(
            validate_plan(&[rows[0].item.clone()]).unwrap_err().code,
            "source_changed"
        );
    }
    #[test]
    fn detects_plan_duplicates_and_keeps_directory_names_and_whitespace() {
        let temp = crate::test_util::TempDir::new("bulk-rules");
        let root = temp.path().to_path_buf();
        let a = root.join("old.json");
        let b = root.join("new.json");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        let mut rule = rules();
        rule.numbering = false;
        let rows = preview(
            vec![
                a.to_string_lossy().into_owned(),
                b.to_string_lossy().into_owned(),
            ],
            rule,
        )
        .unwrap();
        assert!(rows.iter().any(|row| row
            .error
            .as_ref()
            .is_some_and(|e| e.message_key == "errors.renameDuplicate")));
        let directory = root.join("dir.old");
        fs::create_dir(&directory).unwrap();
        let rows = preview(vec![directory.to_string_lossy().into_owned()], rules()).unwrap();
        assert_eq!(rows[0].item.new_name, "접두_dir.new_001");
        let spaced = root.join(if cfg!(windows) { " spaced.txt" } else { " spaced " });
        fs::write(&spaced, "keep").unwrap();
        let mut rule = rules();
        rule.find.clear();
        rule.prefix.clear();
        rule.numbering = false;
        let rows = preview(vec![spaced.to_string_lossy().into_owned()], rule).unwrap();
        assert!(!rows[0].changed);
        assert!(rows[0].error.is_none());
    }
}
