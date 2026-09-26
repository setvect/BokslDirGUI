//! File operations share one registry and cancellation/progress lifecycle.
mod archive_ops;
mod conflict;
mod delete;
mod file_io;
mod process;
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
