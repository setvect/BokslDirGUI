use super::runtime::{
    check_cancelled, emit_progress, error_summary, launch_operation, summary_from_stats,
    OperationStats,
};
use crate::bulk_rename::validate_plan;
use crate::contracts::RenameItem;
use crate::contracts::{
    CommandResult, OperationKind, OperationStarted, OperationState, OperationSummary,
};
use crate::filesystem::map_io_error;
use crate::mutation::rename_no_replace;
use std::path::Path;

pub(crate) fn start(
    app: Option<&tauri::AppHandle>,
    items: Vec<RenameItem>,
) -> CommandResult<OperationStarted> {
    if items.iter().any(|item| crate::remote::path::is_remote_path(&item.source)) {
        return super::remote_ops::start_remote_bulk_rename(app, items);
    }
    validate_plan(&items)?;
    launch_operation(app, OperationKind::Rename, None, move |app, operation_id| {
        run_rename(app, operation_id, &items, None)
    })
}

fn run_rename(
    app: Option<&tauri::AppHandle>,
    id: &str,
    items: &[RenameItem],
    cancel_after: Option<u64>,
) -> OperationSummary {
    if let Err(error) = validate_plan(items) {
        return error_summary(id, OperationKind::Rename, error);
    }
    let mut stats = OperationStats::new(items.len() as u64, 0);
    for item in items {
        let source = Path::new(&item.source);
        if check_cancelled(id, source).is_err()
            || cancel_after.is_some_and(|n| stats.completed_files >= n)
        {
            let mut summary = summary_from_stats(id, OperationKind::Rename, &stats);
            summary.state = OperationState::Cancelled;
            return summary;
        }
        emit_progress(
            app,
            id,
            OperationKind::Rename,
            OperationState::Running,
            &stats,
            Some(source),
        );
        let target = source.with_file_name(&item.new_name);
        if source == target {
            stats.skipped_files += 1;
            continue;
        }
        // 개별 실행 직전에 다시 확인하며 원자적 no-replace rename으로 덮어쓰기 방지.
        let result = validate_plan(std::slice::from_ref(item)).and_then(|_| {
            rename_no_replace(source, &target).map_err(|e| map_io_error(e, Some(&target)))
        });
        match result {
            Ok(()) => stats.completed_files += 1,
            Err(error) => {
                stats.failed_files += 1;
                stats.errors.push(error);
                break;
            }
        }
        emit_progress(
            app,
            id,
            OperationKind::Rename,
            OperationState::Running,
            &stats,
            Some(&target),
        );
    }
    summary_from_stats(id, OperationKind::Rename, &stats)
}

#[cfg(test)]
mod tests {
    use super::run_rename;
    use crate::bulk_rename::{preview, tests::rules};
    use crate::contracts::OperationState;
    use std::fs;
    use std::path::Path;
    #[test]
    fn renames_with_partial_cancel_and_rejects_conflicts_before_any_change() {
        let temp = crate::test_util::TempDir::new("bulk-execute");
        let root = temp.path().to_path_buf();
        let paths: Vec<_> = ["old-a.json", "old-b.json"]
            .iter()
            .map(|n| {
                let p = root.join(n);
                fs::write(&p, n).unwrap();
                p.to_string_lossy().into_owned()
            })
            .collect();
        let items: Vec<_> = preview(paths.clone(), rules())
            .unwrap()
            .into_iter()
            .map(|r| r.item)
            .collect();
        fs::write(root.join(&items[1].new_name), "collision").unwrap();
        assert_eq!(
            run_rename(None, "test", &items, None).state,
            OperationState::Failed
        );
        assert!(paths.iter().all(|p| Path::new(p).exists()));
        fs::remove_file(root.join(&items[1].new_name)).unwrap();
        let summary = run_rename(None, "test", &items, Some(1));
        assert_eq!(summary.state, OperationState::Cancelled);
        assert_eq!(summary.completed_files, 1);
        assert!(root.join(&items[0].new_name).exists());
        assert!(Path::new(&paths[1]).exists());
        let summary = run_rename(None, "test", &items[1..], None);
        assert_eq!(summary.state, OperationState::Completed);
        assert_eq!(summary.completed_files, 1);
    }
    #[cfg(unix)]
    #[test]
    fn renames_the_symlink_not_its_target() {
        let temp = crate::test_util::TempDir::new("bulk-link");
        let root = temp.path().to_path_buf();
        let target = root.join("target.txt");
        fs::write(&target, "target").unwrap();
        let link = root.join("old.json");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let items: Vec<_> = preview(vec![link.to_string_lossy().into_owned()], rules())
            .unwrap()
            .into_iter()
            .map(|r| r.item)
            .collect();
        let summary = run_rename(None, "link", &items, None);
        assert_eq!(summary.state, OperationState::Completed);
        assert_eq!(
            fs::read_link(root.join(&items[0].new_name)).unwrap(),
            target
        );
        assert_eq!(fs::read(&target).unwrap(), b"target");
    }
}
