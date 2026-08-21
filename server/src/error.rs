use tonic::{Code, Status};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Internal(String),
    #[error("{0}")]
    DeadlineExceeded(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn status_code(&self) -> http::StatusCode {
        match self {
            AppError::BadRequest(_) => http::StatusCode::BAD_REQUEST,
            AppError::Unauthorized(_) => http::StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => http::StatusCode::FORBIDDEN,
            AppError::NotFound(_) => http::StatusCode::NOT_FOUND,
            AppError::Conflict(_) => http::StatusCode::CONFLICT,
            AppError::DeadlineExceeded(_) => http::StatusCode::GATEWAY_TIMEOUT,
            AppError::Internal(_) | AppError::Io(_) | AppError::Db(_) | AppError::Json(_) => {
                http::StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }

    pub fn grpc_status(self) -> Status {
        match self {
            AppError::BadRequest(message) => Status::new(Code::InvalidArgument, message),
            AppError::Unauthorized(message) => Status::new(Code::Unauthenticated, message),
            AppError::Forbidden(message) => Status::new(Code::PermissionDenied, message),
            AppError::NotFound(message) => Status::new(Code::NotFound, message),
            AppError::Conflict(message) => Status::new(Code::AlreadyExists, message),
            AppError::Internal(message) => Status::new(Code::Internal, message),
            AppError::DeadlineExceeded(message) => Status::new(Code::DeadlineExceeded, message),
            AppError::Io(error) => Status::new(Code::Internal, error.to_string()),
            AppError::Db(error) => {
                if error.to_string().trim().eq_ignore_ascii_case("not found") {
                    Status::new(Code::NotFound, "not found")
                } else {
                    Status::new(Code::Internal, error.to_string())
                }
            }
            AppError::Json(error) => Status::new(Code::Internal, error.to_string()),
        }
    }
}
