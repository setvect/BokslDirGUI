use std::path::Path;

pub(crate) fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
