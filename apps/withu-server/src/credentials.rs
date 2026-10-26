//! Windows credential store. Only reads Withu-owned targets in one data namespace.
use sha2::{Digest, Sha256};
use std::path::Path;
use zeroize::{Zeroize, Zeroizing};

pub struct Credentials {
    prefix: String,
    fail_write: bool,
}
impl Credentials {
    pub fn new(root: &Path, fail_write: bool) -> Self {
        let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        let hash = format!(
            "{:x}",
            Sha256::digest(root.to_string_lossy().to_lowercase().as_bytes())
        );
        Self {
            prefix: format!("Withu/v3/{hash}/"),
            fail_write,
        }
    }
    pub fn fresh_ref(&self) -> String {
        format!("{}{}", self.prefix, uuid::Uuid::new_v4())
    }
    pub fn owns(&self, target: &str) -> bool {
        target.starts_with(&self.prefix)
            && uuid::Uuid::parse_str(&target[self.prefix.len()..]).is_ok()
    }
    pub fn write(&self, target: &str, key: &str) -> Result<(), &'static str> {
        if !self.owns(target) || key.is_empty() || key.len() > 2560 || key.contains('\0') {
            return Err("credential_value_invalid");
        }
        if self.fail_write {
            return Err("credential_storage_unavailable");
        }
        platform::write(target, key)
    }
    pub fn read(&self, target: &str) -> Result<Zeroizing<Vec<u8>>, &'static str> {
        if !self.owns(target) {
            return Err("credential_scope_invalid");
        }
        platform::read(target)
    }
    pub fn delete(&self, target: &str) -> Result<(), &'static str> {
        if !self.owns(target) {
            return Err("credential_scope_invalid");
        }
        platform::delete(target)
    }
    pub fn collect(&self, live: &[String]) -> Result<(), &'static str> {
        for target in platform::list(&self.prefix)? {
            if self.owns(&target) && !live.contains(&target) {
                self.delete(&target)?;
            }
        }
        Ok(())
    }
}
#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::*;
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    pub fn write(target: &str, key: &str) -> Result<(), &'static str> {
        let mut name = wide(target);
        let mut user = wide("Withu");
        let mut blob = Zeroizing::new(key.as_bytes().to_vec());
        let mut c: CREDENTIALW = unsafe { std::mem::zeroed() };
        c.Type = CRED_TYPE_GENERIC;
        c.TargetName = name.as_mut_ptr();
        c.UserName = user.as_mut_ptr();
        c.CredentialBlobSize = blob.len() as u32;
        c.CredentialBlob = blob.as_mut_ptr();
        c.Persist = CRED_PERSIST_LOCAL_MACHINE;
        if unsafe { CredWriteW(&c, 0) } == 0 {
            return Err("credential_storage_unavailable");
        }
        Ok(())
    }
    pub fn read(target: &str) -> Result<Zeroizing<Vec<u8>>, &'static str> {
        let name = wide(target);
        let mut ptr = std::ptr::null_mut();
        if unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut ptr) } == 0 {
            return Err(if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                "credential_missing"
            } else {
                "credential_storage_unavailable"
            });
        }
        let result = unsafe {
            let c = &*ptr;
            let bytes = if c.CredentialBlobSize == 0 {
                &mut []
            } else {
                std::slice::from_raw_parts_mut(c.CredentialBlob, c.CredentialBlobSize as usize)
            };
            let copy = Zeroizing::new(bytes.to_vec());
            bytes.zeroize();
            CredFree(ptr.cast());
            copy
        };
        Ok(result)
    }
    pub fn delete(target: &str) -> Result<(), &'static str> {
        let name = wide(target);
        if unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            return Err("credential_cleanup_failed");
        }
        Ok(())
    }
    pub fn list(prefix: &str) -> Result<Vec<String>, &'static str> {
        let filter = wide(&format!("{prefix}*"));
        let mut count = 0;
        let mut ptr = std::ptr::null_mut();
        if unsafe { CredEnumerateW(filter.as_ptr(), 0, &mut count, &mut ptr) } == 0 {
            return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Ok(vec![])
            } else {
                Err("credential_storage_unavailable")
            };
        }
        let mut result = vec![];
        unsafe {
            for &credential in std::slice::from_raw_parts(ptr, count as usize) {
                let c = &mut *credential;
                let mut len = 0;
                while *c.TargetName.add(len) != 0 {
                    len += 1;
                }
                result.push(String::from_utf16_lossy(std::slice::from_raw_parts(
                    c.TargetName,
                    len,
                )));
                if c.CredentialBlobSize > 0 {
                    std::slice::from_raw_parts_mut(c.CredentialBlob, c.CredentialBlobSize as usize)
                        .zeroize();
                }
            }
            CredFree(ptr.cast());
        }
        Ok(result)
    }
}
#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn write(_: &str, _: &str) -> Result<(), &'static str> {
        Err("credential_storage_unavailable")
    }
    pub fn read(_: &str) -> Result<Zeroizing<Vec<u8>>, &'static str> {
        Err("credential_storage_unavailable")
    }
    pub fn delete(_: &str) -> Result<(), &'static str> {
        Err("credential_storage_unavailable")
    }
    pub fn list(_: &str) -> Result<Vec<String>, &'static str> {
        Err("credential_storage_unavailable")
    }
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn actual_os_credential_roundtrip_and_scope() {
        let namespace = std::env::temp_dir().join(format!(
            "withu-owned-credential-test-{}",
            uuid::Uuid::new_v4()
        ));
        let store = Credentials::new(&namespace, false);
        let target = store.fresh_ref();
        store.write(&target, "only-fictitious-unit-test").unwrap();
        assert_eq!(&*store.read(&target).unwrap(), b"only-fictitious-unit-test");
        let other = Credentials::new(&namespace.join("different-owner"), false);
        assert!(other.read(&target).is_err());
        store.delete(&target).unwrap();
        assert_eq!(store.read(&target).unwrap_err(), "credential_missing");
    }
}
