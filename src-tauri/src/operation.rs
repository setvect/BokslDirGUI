//! File operations share one registry and cancellation/progress lifecycle.
mod archive_ops;
mod bulk_rename;
pub(crate) use bulk_rename::start as start_bulk_rename;
mod conflict;
mod delete;
mod trash_restore;
pub(crate) use trash_restore::{preview as preview_trash_undo, start as start_trash_undo};
mod file_io;
mod process;
mod remote_ops;
mod remote_transfer;
#[cfg(test)]
pub(crate) use remote_transfer::{run_registered_for_test as run_remote_transfer_registered_for_test, run_remote_transfer};
pub(crate) use remote_ops::start_remote_chmod;
#[cfg(test)]
pub(crate) use remote_ops::{run_remote_chmod, run_remote_delete};
mod shell;
pub(crate) use shell::start as start_shell_command;
#[cfg(test)]
pub(crate) use shell::run_for_test as run_shell_command_for_test;
mod runtime;
mod start;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
mod transfer;
pub(crate) use runtime::cancel_operation;
pub(crate) use runtime::resolve_conflict;
pub(crate) use start::start_archive_add;
pub(crate) use start::start_archive_create;
pub(crate) use start::start_archive_extract;
pub(crate) use start::start_copy;
pub(crate) use start::start_delete;
pub(crate) use start::start_move;
#[cfg(test)]
pub(crate) use test_support::archive_add_summary_for_test;
#[cfg(test)]
pub(crate) use test_support::archive_create_summary_for_test;
#[cfg(test)]
pub(crate) use test_support::archive_entry_is_unsafe_for_test;
#[cfg(test)]
pub(crate) use test_support::archive_entry_listing_cancel_for_test;
#[cfg(test)]
pub(crate) use test_support::archive_extract_summary_for_test;
#[cfg(test)]
pub(crate) use test_support::conflict_decision_after_resolve_for_test;
#[cfg(test)]
pub(crate) use test_support::external_archive_command_cancel_for_test;
#[cfg(test)]
pub(crate) use test_support::start_copy_cancel_after_for_test;

#[cfg(test)]
pub(crate) use file_io::{guard_delete_target, is_cross_device_error};
