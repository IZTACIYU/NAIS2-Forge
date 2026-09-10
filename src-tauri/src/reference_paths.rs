use std::io;
use std::path::{Component, Path, PathBuf};

// Read compatibility only: never rewrite saved paths or move/delete files.
pub fn resolve(path: &Path, app_data: &Path) -> io::Result<PathBuf> {
    match std::fs::metadata(path) {
        Ok(_) => return Ok(path.to_path_buf()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    if app_data.file_name() != Some(std::ffi::OsStr::new("com.iztaciyu.nais2forge")) {
        return Ok(path.to_path_buf());
    }
    let Some(parent) = app_data.parent() else {
        return Ok(path.to_path_buf());
    };
    let legacy = parent.join("com.sunakgo.nais2forge").join("references");
    let Ok(relative) = path.strip_prefix(&legacy) else {
        return Ok(path.to_path_buf());
    };
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Ok(path.to_path_buf());
    }
    let candidate = app_data.join("references").join(relative);
    match std::fs::metadata(&candidate) {
        Ok(metadata) if metadata.is_file() => Ok(candidate),
        Ok(_) => Ok(path.to_path_buf()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_only_missing_legacy_references_without_changing_files() {
        let root = std::env::temp_dir().join(format!(
            "nais-reference-paths-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let app = root.join("com.iztaciyu.nais2forge");
        let old = root.join("com.sunakgo.nais2forge").join("references");
        let new = app.join("references");
        std::fs::create_dir_all(new.join("nested")).unwrap();
        for name in ["original.bin", "encoded_vibe.bin", "nested/한글.bin"] {
            std::fs::write(new.join(name), b"preserved bytes").unwrap();
            assert_eq!(resolve(&old.join(name), &app).unwrap(), new.join(name));
            assert_eq!(
                std::fs::read(resolve(&old.join(name), &app).unwrap()).unwrap(),
                b"preserved bytes"
            );
            assert!(!old.join(name).exists());
            assert_eq!(resolve(&new.join(name), &app).unwrap(), new.join(name));
        }
        // A traversal must stay rejected even when the escaped destination exists.
        std::fs::write(app.join("original.bin"), b"not a reference").unwrap();
        std::fs::create_dir_all(new.join("directory.bin")).unwrap();
        for path in [
            old.join("missing.bin"),
            old.join("directory.bin"),
            old.join("../original.bin"),
            root.join("unrelated/references/original.bin"),
            root.join("com.sunakgo.nais2forge/references-other/original.bin"),
        ] {
            assert_eq!(resolve(&path, &app).unwrap(), path);
        }
        assert_eq!(
            resolve(&old.join("original.bin"), &root.join("dev-app")).unwrap(),
            old.join("original.bin")
        );
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("original.bin"), b"original wins").unwrap();
        assert_eq!(
            resolve(&old.join("original.bin"), &app).unwrap(),
            old.join("original.bin")
        );
        assert_eq!(
            std::fs::read(new.join("original.bin")).unwrap(),
            b"preserved bytes"
        );
        assert_eq!(resolve(&old, &app).unwrap(), old);
        std::fs::remove_dir_all(root).unwrap();
    }
}
