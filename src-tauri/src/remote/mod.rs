//! SFTP 원격 파일 관리: 원격 경로, 연결·인증, 목록·파일 관리, 전송.
// 연결 계층(다음 작업 단위)에서 사용하기 전까지 테스트에서만 사용
#[allow(dead_code)]
pub(crate) mod path;
#[cfg(test)]
pub(crate) mod test_server;
