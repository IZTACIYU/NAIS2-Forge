use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyTokenResult {
    pub valid: bool,
    pub tier: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnlasResult {
    pub success: bool,
    pub fixed: Option<i64>,
    pub purchased: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SubscriptionResponse {
    tier: Option<i32>,
    #[serde(rename = "trainingStepsLeft")]
    training_steps_left: Option<TrainingSteps>,
}

#[derive(Debug, Deserialize)]
struct TrainingSteps {
    #[serde(rename = "fixedTrainingStepsLeft")]
    fixed_training_steps_left: Option<i64>,
    #[serde(rename = "purchasedTrainingSteps")]
    purchased_training_steps: Option<i64>,
}

#[tauri::command]
async fn verify_token(token: String) -> VerifyTokenResult {
    let client = reqwest::Client::new();

    let trimmed_token = token.trim();
    // Remove "Bearer " prefix if user pasted it
    let clean_token = if trimmed_token.to_lowercase().starts_with("bearer ") {
        &trimmed_token[7..]
    } else {
        trimmed_token
    };

    println!(
        "[VerifyToken] Checking token (length: {})",
        clean_token.len()
    );
    println!("[VerifyToken] Token start: {:.5}...", clean_token);

    let result = client
        .get("https://image.novelai.net/user/subscription")
        .header("Authorization", format!("Bearer {}", clean_token))
        .header("Content-Type", "application/json")
        .send()
        .await;

    match result {
        Ok(response) => {
            let status = response.status();
            println!("[VerifyToken] API Response Status: {}", status);

            if status.is_success() {
                match response.json::<SubscriptionResponse>().await {
                    Ok(data) => {
                        println!("[VerifyToken] Success! Tier data: {:?}", data.tier);
                        let tier_name = match data.tier {
                            Some(3) => Some("opus".to_string()),
                            Some(2) => Some("scroll".to_string()),
                            Some(1) => Some("tablet".to_string()),
                            _ => Some("paper".to_string()),
                        };
                        VerifyTokenResult {
                            valid: true,
                            tier: tier_name,
                            error: None,
                        }
                    }
                    Err(e) => {
                        println!("[VerifyToken] JSON Parse Error: {}", e);
                        VerifyTokenResult {
                            valid: false,
                            tier: None,
                            error: Some(format!("JSON 파싱 오류: {}", e)),
                        }
                    }
                }
            } else if status.as_u16() == 401 {
                println!("[VerifyToken] 401 Unauthorized");
                VerifyTokenResult {
                    valid: false,
                    tier: None,
                    error: Some("유효하지 않은 API 토큰".to_string()),
                }
            } else {
                let error_text = response.text().await.unwrap_or_default();
                println!("[VerifyToken] API Error: {} - {}", status, error_text);
                VerifyTokenResult {
                    valid: false,
                    tier: None,
                    error: Some(format!("API 오류: {} ({})", status.as_u16(), error_text)),
                }
            }
        }
        Err(e) => {
            println!("[VerifyToken] Network Error: {}", e);
            VerifyTokenResult {
                valid: false,
                tier: None,
                error: Some(format!("네트워크 오류: {}", e)),
            }
        }
    }
}

#[tauri::command]
async fn get_anlas_balance(token: String) -> AnlasResult {
    let client = reqwest::Client::new();

    let result = client
        .get("https://image.novelai.net/user/subscription")
        .header("Authorization", format!("Bearer {}", token.trim()))
        .header("Content-Type", "application/json")
        .send()
        .await;

    match result {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<SubscriptionResponse>().await {
                    Ok(data) => {
                        let fixed = data
                            .training_steps_left
                            .as_ref()
                            .and_then(|t| t.fixed_training_steps_left);
                        let purchased = data
                            .training_steps_left
                            .as_ref()
                            .and_then(|t| t.purchased_training_steps);
                        AnlasResult {
                            success: true,
                            fixed,
                            purchased,
                            error: None,
                        }
                    }
                    Err(e) => AnlasResult {
                        success: false,
                        fixed: None,
                        purchased: None,
                        error: Some(format!("JSON 파싱 오류: {}", e)),
                    },
                }
            } else {
                AnlasResult {
                    success: false,
                    fixed: None,
                    purchased: None,
                    error: Some(format!("API 오류: {}", response.status().as_u16())),
                }
            }
        }
        Err(e) => AnlasResult {
            success: false,
            fixed: None,
            purchased: None,
            error: Some(format!("네트워크 오류: {}", e)),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpscaleResult {
    pub success: bool,
    pub image_data: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
struct UpscalePayload {
    image: String,
    width: i32,
    height: i32,
    scale: i32,
}

#[tauri::command]
async fn upscale_image(
    token: String,
    image: String,
    width: i32,
    height: i32,
    scale: i32,
) -> UpscaleResult {
    let client = reqwest::Client::new();

    let payload = UpscalePayload {
        image,
        width,
        height,
        scale,
    };

    let result = client
        .post("https://image.novelai.net/ai/upscale")
        .header("Authorization", format!("Bearer {}", token.trim()))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;

    match result {
        Ok(response) => {
            if response.status().is_success() {
                // Response is a ZIP file containing the image
                match response.bytes().await {
                    Ok(bytes) => {
                        // Use zip crate to extract
                        match extract_image_from_zip(&bytes) {
                            Ok(base64_image) => UpscaleResult {
                                success: true,
                                image_data: Some(base64_image),
                                error: None,
                            },
                            Err(e) => UpscaleResult {
                                success: false,
                                image_data: None,
                                error: Some(format!("ZIP 처리 오류: {}", e)),
                            },
                        }
                    }
                    Err(e) => UpscaleResult {
                        success: false,
                        image_data: None,
                        error: Some(format!("응답 읽기 오류: {}", e)),
                    },
                }
            } else {
                let status = response.status().as_u16();
                let error_text = response.text().await.unwrap_or_default();
                UpscaleResult {
                    success: false,
                    image_data: None,
                    error: Some(format!("API 오류 {}: {}", status, error_text)),
                }
            }
        }
        Err(e) => UpscaleResult {
            success: false,
            image_data: None,
            error: Some(format!("네트워크 오류: {}", e)),
        },
    }
}

#[derive(Debug, Serialize)]
struct AugmentPayload {
    image: String,
    width: i32,
    height: i32,
    req_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    defry: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
}

#[tauri::command]
async fn augment_image(
    token: String,
    image: String,
    width: i32,
    height: i32,
    #[allow(non_snake_case)] reqType: String,
    defry: Option<i32>,
    prompt: Option<String>,
) -> UpscaleResult {
    let client = reqwest::Client::new();

    let payload = AugmentPayload {
        image,
        width,
        height,
        req_type: reqType,
        defry,
        prompt,
    };

    let result = client
        .post("https://image.novelai.net/ai/augment-image")
        .header("Authorization", format!("Bearer {}", token.trim()))
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(120))
        .json(&payload)
        .send()
        .await;

    match result {
        Ok(response) => {
            if response.status().is_success() {
                match response.bytes().await {
                    Ok(bytes) => match extract_image_from_zip(&bytes) {
                        Ok(base64_image) => UpscaleResult {
                            success: true,
                            image_data: Some(base64_image),
                            error: None,
                        },
                        Err(e) => UpscaleResult {
                            success: false,
                            image_data: None,
                            error: Some(format!("ZIP 처리 오류: {}", e)),
                        },
                    },
                    Err(e) => UpscaleResult {
                        success: false,
                        image_data: None,
                        error: Some(format!("응답 읽기 오류: {}", e)),
                    },
                }
            } else {
                let status = response.status().as_u16();
                let error_text = response.text().await.unwrap_or_default();
                UpscaleResult {
                    success: false,
                    image_data: None,
                    error: Some(format!("API 오류 {}: {}", status, error_text)),
                }
            }
        }
        Err(e) => UpscaleResult {
            success: false,
            image_data: None,
            error: Some(format!("네트워크 오류: {}", e)),
        },
    }
}

fn extract_image_from_zip(zip_bytes: &[u8]) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    let cursor = Cursor::new(zip_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    if archive.is_empty() {
        return Err("ZIP 파일이 비어있습니다".to_string());
    }

    let mut file = archive.by_index(0).map_err(|e| e.to_string())?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents).map_err(|e| e.to_string())?;

    Ok(STANDARD.encode(&contents))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoveBackgroundResult {
    pub success: bool,
    pub image_data: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
async fn remove_background(image_base64: String) -> RemoveBackgroundResult {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    // Decode base64 image
    let image_bytes = match STANDARD.decode(&image_base64) {
        Ok(bytes) => bytes,
        Err(e) => {
            return RemoveBackgroundResult {
                success: false,
                image_data: None,
                error: Some(format!("Base64 디코딩 오류: {}", e)),
            }
        }
    };

    let client = reqwest::Client::new();

    // Use Hugging Face Inference API (free tier available)
    // Note: For production, consider getting an HF API token
    let result = client
        .post("https://router.huggingface.co/hf-inference/models/briaai/RMBG-1.4")
        .header("Content-Type", "application/octet-stream")
        .body(image_bytes)
        .send()
        .await;

    match result {
        Ok(response) => {
            if response.status().is_success() {
                match response.bytes().await {
                    Ok(bytes) => {
                        let base64_result = STANDARD.encode(&bytes);
                        RemoveBackgroundResult {
                            success: true,
                            image_data: Some(format!("data:image/png;base64,{}", base64_result)),
                            error: None,
                        }
                    }
                    Err(e) => RemoveBackgroundResult {
                        success: false,
                        image_data: None,
                        error: Some(format!("응답 읽기 오류: {}", e)),
                    },
                }
            } else {
                let status = response.status().as_u16();
                let error_text = response.text().await.unwrap_or_default();
                RemoveBackgroundResult {
                    success: false,
                    image_data: None,
                    error: Some(format!("API 오류 {}: {}", status, error_text)),
                }
            }
        }
        Err(e) => RemoveBackgroundResult {
            success: false,
            image_data: None,
            error: Some(format!("네트워크 오류: {}", e)),
        },
    }
}

#[derive(Debug, Deserialize, Clone)]
struct R2Config {
    account_id: String,
    access_key_id: String,
    secret_access_key: String,
    bucket: String,
}

#[derive(Debug, Serialize)]
struct R2ObjectInfo {
    key: String,
    name: String,
    size: u64,
    last_modified: Option<String>,
    is_folder: bool,
}

#[derive(Debug, Serialize)]
struct R2ListResult {
    folders: Vec<R2ObjectInfo>,
    files: Vec<R2ObjectInfo>,
}

fn hmac_sha256(key: &[u8], data: &str) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("hmac key");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(bytes))
}

fn aws_encode(value: &str, keep_slash: bool) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        let ok = b.is_ascii_alphanumeric()
            || matches!(b, b'-' | b'_' | b'.' | b'~')
            || (keep_slash && b == b'/');
        if ok {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn r2_endpoint(config: &R2Config) -> String {
    format!(
        "https://{}.r2.cloudflarestorage.com",
        config.account_id.trim()
    )
}

fn r2_sign_headers(
    config: &R2Config,
    method: &str,
    canonical_uri: &str,
    canonical_query: &str,
    payload_hash: &str,
    content_type: Option<&str>,
) -> Vec<(String, String)> {
    let now = chrono::Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();
    let host = format!("{}.r2.cloudflarestorage.com", config.account_id.trim());

    let mut canonical_headers = format!(
        "host:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\n",
        host, payload_hash, amz_date
    );
    let mut signed_headers = "host;x-amz-content-sha256;x-amz-date".to_string();
    if let Some(ct) = content_type {
        canonical_headers = format!("content-type:{}\n{}", ct, canonical_headers);
        signed_headers = format!("content-type;{}", signed_headers);
    }

    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method, canonical_uri, canonical_query, canonical_headers, signed_headers, payload_hash
    );
    let credential_scope = format!("{}/auto/s3/aws4_request", date_stamp);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );

    let k_date = hmac_sha256(
        format!("AWS4{}", config.secret_access_key).as_bytes(),
        &date_stamp,
    );
    let k_region = hmac_sha256(&k_date, "auto");
    let k_service = hmac_sha256(&k_region, "s3");
    let k_signing = hmac_sha256(&k_service, "aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, &string_to_sign));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        config.access_key_id.trim(),
        credential_scope,
        signed_headers,
        signature
    );

    let mut headers = vec![
        ("Authorization".to_string(), authorization),
        ("x-amz-content-sha256".to_string(), payload_hash.to_string()),
        ("x-amz-date".to_string(), amz_date),
    ];
    if let Some(ct) = content_type {
        headers.push(("Content-Type".to_string(), ct.to_string()));
    }
    headers
}

fn xml_text(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(block[start..end].replace("&amp;", "&"))
}

fn split_xml_blocks<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let mut blocks = Vec::new();
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let from = start + open.len();
        if let Some(end_rel) = rest[from..].find(&close) {
            let end = from + end_rel;
            blocks.push(&rest[from..end]);
            rest = &rest[end + close.len()..];
        } else {
            break;
        }
    }
    blocks
}

#[tauri::command]
async fn r2_list_objects(config: R2Config, prefix: Option<String>) -> Result<R2ListResult, String> {
    let prefix = prefix.unwrap_or_default();
    let canonical_uri = format!("/{}", aws_encode(config.bucket.trim(), true));
    let canonical_query = format!(
        "delimiter=%2F&list-type=2&prefix={}",
        aws_encode(&prefix, false)
    );
    let url = format!(
        "{}{}?{}",
        r2_endpoint(&config),
        canonical_uri,
        canonical_query
    );
    let payload_hash = sha256_hex(b"");
    let headers = r2_sign_headers(
        &config,
        "GET",
        &canonical_uri,
        &canonical_query,
        &payload_hash,
        None,
    );
    let client = reqwest::Client::new();
    let mut req = client.get(url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let response = req.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("R2 list failed: {} {}", status, body));
    }
    let xml = response.text().await.map_err(|e| e.to_string())?;
    let folders = split_xml_blocks(&xml, "CommonPrefixes")
        .into_iter()
        .filter_map(|block| {
            let key = xml_text(block, "Prefix")?;
            let name = key
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or(&key)
                .to_string();
            Some(R2ObjectInfo {
                key,
                name,
                size: 0,
                last_modified: None,
                is_folder: true,
            })
        })
        .collect();
    let files = split_xml_blocks(&xml, "Contents")
        .into_iter()
        .filter_map(|block| {
            let key = xml_text(block, "Key")?;
            if key.ends_with('/') {
                return None;
            }
            let name = key.rsplit('/').next().unwrap_or(&key).to_string();
            let size = xml_text(block, "Size")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let last_modified = xml_text(block, "LastModified");
            Some(R2ObjectInfo {
                key,
                name,
                size,
                last_modified,
                is_folder: false,
            })
        })
        .collect();
    Ok(R2ListResult { folders, files })
}

#[tauri::command]
async fn r2_put_object(
    config: R2Config,
    key: String,
    content_base64: String,
    content_type: Option<String>,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let body = STANDARD.decode(content_base64).map_err(|e| e.to_string())?;
    let canonical_uri = format!(
        "/{}/{}",
        aws_encode(config.bucket.trim(), true),
        aws_encode(&key, true)
    );
    let canonical_query = "";
    let payload_hash = sha256_hex(&body);
    let content_type = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
    let headers = r2_sign_headers(
        &config,
        "PUT",
        &canonical_uri,
        canonical_query,
        &payload_hash,
        Some(&content_type),
    );
    let url = format!("{}{}", r2_endpoint(&config), canonical_uri);
    let content_length = body.len();
    let client = reqwest::Client::new();
    let mut req = client
        .put(url)
        .body(body)
        .header("Content-Length", content_length);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let response = req.send().await.map_err(|e| e.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!("R2 upload failed: {} {}", status, body))
    }
}

#[tauri::command]
async fn r2_delete_object(config: R2Config, key: String) -> Result<(), String> {
    let canonical_uri = format!(
        "/{}/{}",
        aws_encode(config.bucket.trim(), true),
        aws_encode(&key, true)
    );
    let canonical_query = "";
    let payload_hash = sha256_hex(b"");
    let headers = r2_sign_headers(
        &config,
        "DELETE",
        &canonical_uri,
        canonical_query,
        &payload_hash,
        None,
    );
    let url = format!("{}{}", r2_endpoint(&config), canonical_uri);
    let client = reqwest::Client::new();
    let mut req = client.delete(url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let response = req.send().await.map_err(|e| e.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!("R2 delete failed: {} {}", status, body))
    }
}

#[tauri::command]
async fn r2_delete_prefix(config: R2Config, prefix: String) -> Result<(), String> {
    let mut root_prefix = prefix;
    if !root_prefix.ends_with('/') {
        root_prefix.push('/');
    }

    let mut stack = vec![root_prefix.clone()];
    while let Some(current_prefix) = stack.pop() {
        let listed = r2_list_objects(config.clone(), Some(current_prefix.clone())).await?;
        for folder in listed.folders {
            stack.push(folder.key);
        }
        for file in listed.files {
            r2_delete_object(config.clone(), file.key).await?;
        }
        let _ = r2_delete_object(config.clone(), current_prefix).await;
    }
    Ok(())
}

#[tauri::command]
async fn r2_create_folder(config: R2Config, key: String) -> Result<(), String> {
    let folder_key = if key.ends_with('/') {
        key
    } else {
        format!("{}/", key)
    };
    r2_put_object(
        config,
        folder_key,
        String::new(),
        Some("application/x-directory".to_string()),
    )
    .await
}

#[tauri::command]
async fn create_reference_thumbnail(
    source_base64: Option<String>,
    file_path: Option<String>,
    width: u32,
    height: u32,
    quality: u8,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        use image::codecs::jpeg::JpegEncoder;
        use image::imageops::FilterType;

        if width == 0 || height == 0 {
            return Err("Thumbnail dimensions must be greater than zero".to_string());
        }

        let bytes = if let Some(path) = file_path.filter(|path| !path.is_empty()) {
            std::fs::read(path)
                .map_err(|error| format!("Failed to read reference image: {error}"))?
        } else if let Some(encoded) = source_base64.filter(|value| !value.is_empty()) {
            let raw = encoded
                .split_once(',')
                .map(|(_, data)| data)
                .unwrap_or(encoded.as_str());
            STANDARD
                .decode(raw)
                .map_err(|error| format!("Failed to decode reference image: {error}"))?
        } else {
            return Err("No reference image source was provided".to_string());
        };

        let source = image::load_from_memory(&bytes)
            .map_err(|error| format!("Unsupported reference image: {error}"))?;
        let thumbnail = source.resize_to_fill(width, height, FilterType::Lanczos3);
        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, quality.clamp(1, 100))
            .encode_image(&thumbnail)
            .map_err(|error| format!("Failed to encode reference thumbnail: {error}"))?;

        Ok(format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode(encoded)
        ))
    })
    .await
    .map_err(|error| format!("Thumbnail worker failed: {error}"))?
}

#[tauri::command]
async fn create_library_thumbnail(
    file_path: String,
    output_path: String,
    max_edge: u32,
    quality: f32,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use image::imageops::FilterType;
        use image::GenericImageView;

        if max_edge == 0 {
            return Err("Thumbnail max edge must be greater than zero".to_string());
        }
        if let Some(parent) = std::path::Path::new(&output_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create thumbnail directory: {error}"))?;
        }

        let source = image::open(&file_path)
            .map_err(|error| format!("Failed to decode library image: {error}"))?;
        let (width, height) = source.dimensions();
        let scale = (max_edge as f64 / width.max(height) as f64).min(1.0);
        let target_width = ((width as f64 * scale).round() as u32).max(1);
        let target_height = ((height as f64 * scale).round() as u32).max(1);
        let thumbnail = source.resize_exact(target_width, target_height, FilterType::Lanczos3);
        let rgb = thumbnail.to_rgb8();
        let encoded = webp::Encoder::from_rgb(rgb.as_raw(), target_width, target_height)
            .encode(quality.clamp(1.0, 100.0));

        if !std::path::Path::new(&file_path).exists() {
            return Err("Original image was removed".to_string());
        }
        std::fs::write(&output_path, &*encoded)
            .map_err(|error| format!("Failed to write library thumbnail: {error}"))?;
        Ok(output_path)
    })
    .await
    .map_err(|error| format!("Library thumbnail worker failed: {error}"))?
}

#[tauri::command]
async fn find_missing_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        Ok(paths
            .into_iter()
            .filter(|path| !std::path::Path::new(path).is_file())
            .collect())
    })
    .await
    .map_err(|error| format!("File validation worker failed: {error}"))?
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderMove {
    source_path: String,
    destination_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderMigrationResult {
    files_moved: usize,
    bytes_moved: u64,
    cleanup_failures: usize,
}

struct PlannedFileMove {
    source: std::path::PathBuf,
    destination: std::path::PathBuf,
    size: u64,
}

fn normalized_path_key(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn paths_overlap(left: &std::path::Path, right: &std::path::Path) -> bool {
    let left_key = normalized_path_key(left);
    let right_key = normalized_path_key(right);
    left_key == right_key
        || left_key.starts_with(&(right_key.clone() + "\\"))
        || right_key.starts_with(&(left_key + "\\"))
}

fn collect_folder_move(
    source: &std::path::Path,
    destination: &std::path::Path,
    excluded_sources: &[std::path::PathBuf],
    directories: &mut Vec<(std::path::PathBuf, std::path::PathBuf)>,
    files: &mut Vec<PlannedFileMove>,
) -> Result<(), String> {
    directories.push((source.to_path_buf(), destination.to_path_buf()));
    let entries = std::fs::read_dir(source)
        .map_err(|error| format!("Failed to read source folder {}: {error}", source.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read folder entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", source_path.display()))?;

        if file_type.is_dir() {
            let source_key = normalized_path_key(&source_path);
            if excluded_sources
                .iter()
                .any(|excluded| normalized_path_key(excluded) == source_key)
            {
                continue;
            }
            collect_folder_move(
                &source_path,
                &destination_path,
                excluded_sources,
                directories,
                files,
            )?;
        } else if file_type.is_file() {
            let size = entry
                .metadata()
                .map_err(|error| format!("Failed to inspect {}: {error}", source_path.display()))?
                .len();
            files.push(PlannedFileMove {
                source: source_path,
                destination: destination_path,
                size,
            });
        } else {
            return Err(format!(
                "Unsupported file type in source folder: {}",
                source_path.display()
            ));
        }
    }
    Ok(())
}

fn cleanup_copied_files(files: &[std::path::PathBuf], directories: &[std::path::PathBuf]) {
    for path in files.iter().rev() {
        let _ = std::fs::remove_file(path);
    }
    for path in directories.iter().rev() {
        let _ = std::fs::remove_dir(path);
    }
}

fn migrate_folders_blocking(moves: Vec<FolderMove>) -> Result<FolderMigrationResult, String> {
    use std::collections::HashSet;
    use std::path::PathBuf;

    let moves: Vec<(PathBuf, PathBuf)> = moves
        .into_iter()
        .map(|entry| {
            (
                PathBuf::from(entry.source_path),
                PathBuf::from(entry.destination_path),
            )
        })
        .filter(|(source, destination)| {
            normalized_path_key(source) != normalized_path_key(destination)
        })
        .collect();
    let source_roots: Vec<PathBuf> = moves.iter().map(|(source, _)| source.clone()).collect();

    for (source, destination) in &moves {
        if source.exists() && !source.is_dir() {
            return Err(format!("Source is not a folder: {}", source.display()));
        }
        for source_root in &source_roots {
            if paths_overlap(destination, source_root) {
                return Err(format!(
                    "Source and destination folders must not overlap: {} -> {}",
                    source.display(),
                    destination.display()
                ));
            }
        }
    }

    let mut directories = Vec::new();
    let mut files = Vec::new();
    for (source, destination) in &moves {
        if !source.exists() {
            continue;
        }
        let excluded_sources: Vec<PathBuf> = source_roots
            .iter()
            .filter(|candidate| normalized_path_key(candidate) != normalized_path_key(source))
            .cloned()
            .collect();
        collect_folder_move(
            source,
            destination,
            &excluded_sources,
            &mut directories,
            &mut files,
        )?;
    }

    let mut destination_files = HashSet::new();
    for file in &files {
        let destination_key = normalized_path_key(&file.destination);
        if !destination_files.insert(destination_key) {
            return Err(format!(
                "Multiple source files map to the same destination: {}",
                file.destination.display()
            ));
        }
        if file.destination.exists() {
            return Err(format!(
                "A file already exists in the destination: {}",
                file.destination.display()
            ));
        }
    }

    directories.sort_by_key(|(_, destination)| destination.components().count());
    let mut unique_destination_dirs = HashSet::new();
    let mut created_directories = Vec::new();
    for (_, destination) in &directories {
        let key = normalized_path_key(destination);
        if !unique_destination_dirs.insert(key) {
            continue;
        }
        if destination.exists() {
            if !destination.is_dir() {
                return Err(format!(
                    "Destination path is not a folder: {}",
                    destination.display()
                ));
            }
            continue;
        }
        if let Err(error) = std::fs::create_dir_all(destination) {
            cleanup_copied_files(&[], &created_directories);
            return Err(format!(
                "Failed to create destination folder {}: {error}",
                destination.display()
            ));
        }
        created_directories.push(destination.clone());
    }

    let mut copied_files = Vec::new();
    for file in &files {
        if let Some(parent) = file.destination.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                cleanup_copied_files(&copied_files, &created_directories);
                return Err(format!(
                    "Failed to create destination folder {}: {error}",
                    parent.display()
                ));
            }
        }
        if let Err(error) = std::fs::copy(&file.source, &file.destination) {
            cleanup_copied_files(&copied_files, &created_directories);
            return Err(format!("Failed to copy {}: {error}", file.source.display()));
        }
        copied_files.push(file.destination.clone());
    }

    for file in &files {
        let copied_size = match std::fs::metadata(&file.destination) {
            Ok(metadata) => metadata.len(),
            Err(error) => {
                cleanup_copied_files(&copied_files, &created_directories);
                return Err(format!(
                    "Failed to verify {}: {error}",
                    file.destination.display()
                ));
            }
        };
        if copied_size != file.size {
            cleanup_copied_files(&copied_files, &created_directories);
            return Err(format!(
                "Copied file verification failed: {}",
                file.destination.display()
            ));
        }
    }

    let mut cleanup_failures = 0;
    for file in &files {
        if std::fs::remove_file(&file.source).is_err() {
            cleanup_failures += 1;
        }
    }
    directories.sort_by_key(|(source, _)| std::cmp::Reverse(source.components().count()));
    let mut removed_source_dirs = HashSet::new();
    for (source, _) in &directories {
        if removed_source_dirs.insert(normalized_path_key(source))
            && std::fs::remove_dir(source).is_err()
        {
            if source.exists() {
                cleanup_failures += 1;
            }
        }
    }

    Ok(FolderMigrationResult {
        files_moved: files.len(),
        bytes_moved: files.iter().map(|file| file.size).sum(),
        cleanup_failures,
    })
}

#[tauri::command]
async fn migrate_folders(moves: Vec<FolderMove>) -> Result<FolderMigrationResult, String> {
    tokio::task::spawn_blocking(move || migrate_folders_blocking(moves))
        .await
        .map_err(|error| format!("Folder migration worker failed: {error}"))?
}

#[cfg(test)]
mod folder_migration_tests {
    use super::*;

    fn test_root(name: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("nais2-{name}-{nonce}"))
    }

    #[test]
    fn migrates_files_after_verification() {
        let root = test_root("folder-move");
        let source = root.join("source");
        let destination = root.join("destination");
        std::fs::create_dir_all(source.join("nested")).unwrap();
        std::fs::write(source.join("image.png"), b"image-data").unwrap();
        std::fs::write(source.join("nested").join("thumb.webp"), b"thumbnail").unwrap();

        let result = migrate_folders_blocking(vec![FolderMove {
            source_path: source.to_string_lossy().into_owned(),
            destination_path: destination.to_string_lossy().into_owned(),
        }])
        .unwrap();

        assert_eq!(result.files_moved, 2);
        assert!(!source.exists());
        assert_eq!(
            std::fs::read(destination.join("image.png")).unwrap(),
            b"image-data"
        );
        assert_eq!(
            std::fs::read(destination.join("nested").join("thumb.webp")).unwrap(),
            b"thumbnail"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn maps_nested_scene_folder_only_once() {
        let root = test_root("nested-folder-move");
        let source_main = root.join("old-main");
        let source_scene = source_main.join("NAIS_Scene");
        let destination_main = root.join("new-main");
        let destination_scene = root.join("new-scenes");
        std::fs::create_dir_all(&source_scene).unwrap();
        std::fs::write(source_main.join("main.png"), b"main").unwrap();
        std::fs::write(source_scene.join("scene.png"), b"scene").unwrap();

        let result = migrate_folders_blocking(vec![
            FolderMove {
                source_path: source_scene.to_string_lossy().into_owned(),
                destination_path: destination_scene.to_string_lossy().into_owned(),
            },
            FolderMove {
                source_path: source_main.to_string_lossy().into_owned(),
                destination_path: destination_main.to_string_lossy().into_owned(),
            },
        ])
        .unwrap();

        assert_eq!(result.files_moved, 2);
        assert!(destination_main.join("main.png").is_file());
        assert!(destination_scene.join("scene.png").is_file());
        assert!(!destination_main.join("NAIS_Scene").exists());
        assert!(!source_main.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeCharacterReference {
    file_path: Option<String>,
    source_base64: Option<String>,
    cache_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeVibeReference {
    file_path: Option<String>,
    source_base64: Option<String>,
    encoded_vibe: Option<String>,
    encoded_vibe_path: Option<String>,
    information_extracted: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeGenerationResult {
    success: bool,
    response_base64: Option<String>,
    encoded_vibes: Vec<String>,
    error: Option<String>,
}

fn read_reference_bytes(
    file_path: Option<&str>,
    source_base64: Option<&str>,
) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    if let Some(path) = file_path.filter(|path| !path.is_empty()) {
        return std::fs::read(path)
            .map_err(|error| format!("Failed to read reference image: {error}"));
    }

    let encoded = source_base64
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Reference image source is missing".to_string())?;
    let raw = encoded
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(encoded);
    STANDARD
        .decode(raw)
        .map_err(|error| format!("Failed to decode reference image: {error}"))
}

async fn prepare_character_reference(
    reference: NativeCharacterReference,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        use image::codecs::jpeg::JpegEncoder;
        use image::imageops::{overlay, FilterType};
        use image::GenericImageView;

        let bytes = read_reference_bytes(
            reference.file_path.as_deref(),
            reference.source_base64.as_deref(),
        )?;
        let source = image::load_from_memory(&bytes)
            .map_err(|error| format!("Unsupported character reference image: {error}"))?;
        let (width, height) = source.dimensions();
        let (target_width, target_height) = if width > height {
            (1536, 1024)
        } else if width < height {
            (1024, 1536)
        } else {
            (1472, 1472)
        };
        let scale = (target_width as f64 / width as f64).min(target_height as f64 / height as f64);
        let resized_width = ((width as f64 * scale).round() as u32).max(1);
        let resized_height = ((height as f64 * scale).round() as u32).max(1);
        let resized = source.resize_exact(resized_width, resized_height, FilterType::Lanczos3);
        let mut canvas = image::DynamicImage::new_rgb8(target_width, target_height);
        overlay(
            &mut canvas,
            &resized,
            ((target_width - resized_width) / 2) as i64,
            ((target_height - resized_height) / 2) as i64,
        );

        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, 95)
            .encode_image(&canvas)
            .map_err(|error| format!("Failed to encode character reference: {error}"))?;
        Ok(STANDARD.encode(encoded))
    })
    .await
    .map_err(|error| format!("Character reference worker failed: {error}"))?
}

async fn prepare_generation_references(
    client: &reqwest::Client,
    token: &str,
    mut payload: serde_json::Value,
    character_references: Vec<NativeCharacterReference>,
    vibe_references: Vec<NativeVibeReference>,
) -> Result<(serde_json::Value, Vec<String>), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let mut processed_characters = Vec::new();
    let mut cached_characters = Vec::new();
    for reference in character_references {
        if let Some(cache_key) = reference.cache_key.as_ref().filter(|key| !key.is_empty()) {
            cached_characters.push(serde_json::json!({ "cache_secret_key": cache_key }));
        } else {
            processed_characters.push(prepare_character_reference(reference).await?);
        }
    }

    let mut processed_vibes = Vec::new();
    let mut newly_encoded_vibes = Vec::new();
    for reference in vibe_references {
        if let Some(encoded) = reference.encoded_vibe.filter(|value| !value.is_empty()) {
            processed_vibes.push(encoded);
            continue;
        }
        if let Some(path) = reference
            .encoded_vibe_path
            .as_deref()
            .filter(|path| !path.is_empty())
        {
            let encoded_bytes = tokio::fs::read(path)
                .await
                .map_err(|error| format!("Failed to read encoded vibe cache: {error}"))?;
            processed_vibes.push(STANDARD.encode(encoded_bytes));
            continue;
        }

        let bytes = tokio::task::spawn_blocking({
            let file_path = reference.file_path.clone();
            let source_base64 = reference.source_base64.clone();
            move || read_reference_bytes(file_path.as_deref(), source_base64.as_deref())
        })
        .await
        .map_err(|error| format!("Vibe reference worker failed: {error}"))??;
        let encoded_source = STANDARD.encode(bytes);
        let response = client
            .post("https://image.novelai.net/ai/encode-vibe")
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .header("User-Agent", "NAIS2_Client/1.0")
            .json(&serde_json::json!({
                "image": encoded_source,
                "model": "nai-diffusion-4-5-full",
                "information_extracted": reference.information_extracted,
            }))
            .send()
            .await
            .map_err(|error| format!("Vibe encoding request failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Vibe encoding failed: {status} {body}"));
        }
        let encoded = STANDARD.encode(
            response
                .bytes()
                .await
                .map_err(|error| format!("Failed to read encoded vibe: {error}"))?,
        );
        processed_vibes.push(encoded.clone());
        newly_encoded_vibes.push(encoded);
    }

    let parameters = payload
        .get_mut("parameters")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| "Generation payload parameters are missing".to_string())?;
    parameters.remove("director_reference_images");
    parameters.remove("director_reference_images_cached");
    parameters.remove("reference_image_multiple");
    if !processed_characters.is_empty() {
        parameters.insert(
            "director_reference_images".to_string(),
            serde_json::Value::Array(
                processed_characters
                    .into_iter()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    if !cached_characters.is_empty() {
        parameters.insert(
            "director_reference_images_cached".to_string(),
            serde_json::Value::Array(cached_characters),
        );
    }
    if !processed_vibes.is_empty() {
        parameters.insert(
            "reference_image_multiple".to_string(),
            serde_json::Value::Array(
                processed_vibes
                    .into_iter()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }

    Ok((payload, newly_encoded_vibes))
}

#[tauri::command]
async fn generate_image_with_references(
    token: String,
    payload: serde_json::Value,
    character_references: Vec<NativeCharacterReference>,
    vibe_references: Vec<NativeVibeReference>,
) -> NativeGenerationResult {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let client = reqwest::Client::new();
    let token = token.trim().to_string();
    let prepared = prepare_generation_references(
        &client,
        &token,
        payload,
        character_references,
        vibe_references,
    )
    .await;
    let (payload, encoded_vibes) = match prepared {
        Ok(value) => value,
        Err(error) => {
            return NativeGenerationResult {
                success: false,
                response_base64: None,
                encoded_vibes: Vec::new(),
                error: Some(error),
            }
        }
    };

    let response = client
        .post("https://image.novelai.net/ai/generate-image")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "NAIS2_Client/1.0")
        .json(&payload)
        .send()
        .await;
    match response {
        Ok(response) => {
            let status = response.status();
            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                return NativeGenerationResult {
                    success: false,
                    response_base64: None,
                    encoded_vibes,
                    error: Some(format!("API Error: {status} {body}")),
                };
            }
            match response.bytes().await {
                Ok(bytes) => NativeGenerationResult {
                    success: true,
                    response_base64: Some(STANDARD.encode(bytes)),
                    encoded_vibes,
                    error: None,
                },
                Err(error) => NativeGenerationResult {
                    success: false,
                    response_base64: None,
                    encoded_vibes,
                    error: Some(format!("Failed to read generation response: {error}")),
                },
            }
        }
        Err(error) => NativeGenerationResult {
            success: false,
            response_base64: None,
            encoded_vibes,
            error: Some(format!("Generation request failed: {error}")),
        },
    }
}

#[tauri::command]
async fn generate_image_stream_with_references(
    token: String,
    payload: serde_json::Value,
    character_references: Vec<NativeCharacterReference>,
    vibe_references: Vec<NativeVibeReference>,
    on_chunk: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> NativeGenerationResult {
    let client = reqwest::Client::new();
    let token = token.trim().to_string();
    let prepared = prepare_generation_references(
        &client,
        &token,
        payload,
        character_references,
        vibe_references,
    )
    .await;
    let (payload, encoded_vibes) = match prepared {
        Ok(value) => value,
        Err(error) => {
            return NativeGenerationResult {
                success: false,
                response_base64: None,
                encoded_vibes: Vec::new(),
                error: Some(error),
            }
        }
    };

    let response = client
        .post("https://image.novelai.net/ai/generate-image-stream")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/x-msgpack")
        .header("User-Agent", "NAIS2_Client/1.0")
        .json(&payload)
        .send()
        .await;
    let mut response = match response {
        Ok(response) => response,
        Err(error) => {
            return NativeGenerationResult {
                success: false,
                response_base64: None,
                encoded_vibes,
                error: Some(format!("Streaming request failed: {error}")),
            }
        }
    };
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return NativeGenerationResult {
            success: false,
            response_base64: None,
            encoded_vibes,
            error: Some(format!("API Error: {status} {body}")),
        };
    }

    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(error) =
                    on_chunk.send(tauri::ipc::InvokeResponseBody::Raw(chunk.to_vec()))
                {
                    return NativeGenerationResult {
                        success: false,
                        response_base64: None,
                        encoded_vibes,
                        error: Some(format!("Failed to forward stream data: {error}")),
                    };
                }
            }
            Ok(None) => break,
            Err(error) => {
                return NativeGenerationResult {
                    success: false,
                    response_base64: None,
                    encoded_vibes,
                    error: Some(format!("Failed to read stream data: {error}")),
                }
            }
        }
    }

    if let Err(error) = on_chunk.send(tauri::ipc::InvokeResponseBody::Json(
        "{\"done\":true}".to_string(),
    )) {
        return NativeGenerationResult {
            success: false,
            response_base64: None,
            encoded_vibes,
            error: Some(format!("Failed to send stream completion: {error}")),
        };
    }

    NativeGenerationResult {
        success: true,
        response_base64: None,
        encoded_vibes,
        error: None,
    }
}

fn open_state_database(path: &std::path::Path) -> Result<rusqlite::Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create state database directory: {error}"))?;
    }

    let connection = rusqlite::Connection::open(path)
        .map_err(|error| format!("Failed to open state database: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("Failed to configure state database timeout: {error}"))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Failed to enable state database WAL mode: {error}"))?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| format!("Failed to configure state database sync mode: {error}"))?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );",
        )
        .map_err(|error| format!("Failed to initialize state database: {error}"))?;
    Ok(connection)
}

fn state_database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("nais2-forge-state.sqlite3"))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

#[tauri::command]
async fn state_db_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let path = state_database_path(&app)?;
    tokio::task::spawn_blocking(move || {
        use rusqlite::OptionalExtension;

        let connection = open_state_database(&path)?;
        connection
            .query_row(
                "SELECT value FROM app_state WHERE key = ?1",
                [&key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Failed to read state database key: {error}"))
    })
    .await
    .map_err(|error| format!("State database read worker failed: {error}"))?
}

#[tauri::command]
async fn state_db_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let path = state_database_path(&app)?;
    tokio::task::spawn_blocking(move || {
        let connection = open_state_database(&path)?;
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(i64::MAX as u128) as i64;
        connection
            .execute(
                "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                rusqlite::params![key, value, updated_at],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to write state database key: {error}"))
    })
    .await
    .map_err(|error| format!("State database write worker failed: {error}"))?
}

#[tauri::command]
async fn state_db_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = state_database_path(&app)?;
    tokio::task::spawn_blocking(move || {
        let connection = open_state_database(&path)?;
        connection
            .execute("DELETE FROM app_state WHERE key = ?1", [&key])
            .map(|_| ())
            .map_err(|error| format!("Failed to remove state database key: {error}"))
    })
    .await
    .map_err(|error| format!("State database remove worker failed: {error}"))?
}

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url};

// Store for tracking embedded webviews
struct EmbeddedWebviews {
    webviews: HashMap<String, bool>,
}

static EMBEDDED_WEBVIEWS: std::sync::LazyLock<Mutex<EmbeddedWebviews>> =
    std::sync::LazyLock::new(|| {
        Mutex::new(EmbeddedWebviews {
            webviews: HashMap::new(),
        })
    });

#[tauri::command]
async fn open_embedded_browser(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // Close existing embedded browser if any
    let _ = close_embedded_browser(app.clone()).await;

    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    // Get the main window (not WebviewWindow, but Window for add_child)
    let window = app.get_window("main").ok_or("Main window not found")?;

    // Create a WebviewBuilder for the embedded browser
    let webview_builder = tauri::webview::WebviewBuilder::new(
        "embedded_browser",
        tauri::WebviewUrl::External(parsed_url),
    );

    // Add as child webview within the main window
    window
        .add_child(
            webview_builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Failed to create embedded webview: {}", e))?;

    // Track the webview
    if let Ok(mut store) = EMBEDDED_WEBVIEWS.lock() {
        store.webviews.insert("embedded_browser".to_string(), true);
    }

    Ok(())
}

#[tauri::command]
async fn close_embedded_browser(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        webview
            .close()
            .map_err(|e| format!("Failed to close: {}", e))?;
    }

    if let Ok(mut store) = EMBEDDED_WEBVIEWS.lock() {
        store.webviews.remove("embedded_browser");
    }

    Ok(())
}

#[tauri::command]
async fn navigate_embedded_browser(app: AppHandle, url: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
        webview
            .navigate(parsed_url)
            .map_err(|e| format!("Navigation failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_embedded_browser(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Position failed: {}", e))?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| format!("Size failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn show_embedded_browser(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        webview.show().map_err(|e| format!("Show failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_embedded_browser(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        webview.hide().map_err(|e| format!("Hide failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn is_browser_open(app: AppHandle) -> bool {
    app.get_webview("embedded_browser").is_some()
}

#[tauri::command]
async fn zoom_embedded_browser(app: AppHandle, zoom_level: f64) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        // Use CSS zoom property via JavaScript
        let js = format!("document.body.style.zoom = '{}';", zoom_level);
        webview
            .eval(&js)
            .map_err(|e| format!("Zoom failed: {}", e))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            verify_token,
            get_anlas_balance,
            upscale_image,
            augment_image,
            remove_background,
            open_embedded_browser,
            close_embedded_browser,
            navigate_embedded_browser,
            resize_embedded_browser,
            show_embedded_browser,
            hide_embedded_browser,
            is_browser_open,
            zoom_embedded_browser,
            r2_list_objects,
            r2_put_object,
            r2_delete_object,
            r2_delete_prefix,
            r2_create_folder,
            create_reference_thumbnail,
            create_library_thumbnail,
            find_missing_files,
            migrate_folders,
            generate_image_with_references,
            generate_image_stream_with_references,
            state_db_get,
            state_db_set,
            state_db_remove,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(true);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
