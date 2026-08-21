use std::io;
use toml::de::Error as TomlDeError;
use toml::ser::Error as TomlSerError;
use tonic::Status;
use tonic::transport::Error as TonicTransportError;

#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("")]
    Silent,
    #[error("{0}")]
    Message(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Toml(String),
    #[error("{0}")]
    Rpc(String),
}

pub type Result<T> = std::result::Result<T, CliError>;

pub fn fail<T>(message: impl Into<String>) -> Result<T> {
    Err(CliError::Message(message.into()))
}

impl From<io::Error> for CliError {
    fn from(value: io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<TomlDeError> for CliError {
    fn from(value: TomlDeError) -> Self {
        Self::Toml(value.to_string())
    }
}

impl From<TomlSerError> for CliError {
    fn from(value: TomlSerError) -> Self {
        Self::Toml(value.to_string())
    }
}

impl From<Status> for CliError {
    fn from(value: Status) -> Self {
        let message = value.message();
        if message.is_empty() {
            Self::Rpc(value.to_string())
        } else {
            Self::Rpc(message.to_string())
        }
    }
}

impl From<TonicTransportError> for CliError {
    fn from(value: TonicTransportError) -> Self {
        Self::Rpc(value.to_string())
    }
}
