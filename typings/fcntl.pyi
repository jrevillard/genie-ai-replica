# Local type stub for the Unix-only `fcntl` stdlib module.
#
# WHY THIS EXISTS: genie-ai-overlay services run in Linux containers, and
# dataprep/chatqna import `fcntl` for ingest slot locking. On a Windows
# checkout Pylance cannot resolve `fcntl` (the module does not exist on
# Windows) and marks every importing file error-level red — even though the
# code compiles and only ever executes in the container. This stub lets the
# language server resolve the import ANALYTICALLY; it has zero runtime
# effect (Pylance stubs are never executed, and Linux keeps using the real
# stdlib module).
#
# Only the symbols the overlay actually uses are declared; extend as needed.

LOCK_EX: int
LOCK_NB: int
LOCK_SH: int
LOCK_UN: int

def flock(fd: int, operation: int) -> None: ...
def lockf(fd: int, operation: int, len: int = ..., start: int = ..., whence: int = ...) -> None: ...
