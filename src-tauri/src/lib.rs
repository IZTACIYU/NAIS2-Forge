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
        if let Some(path) = reference.encoded_vibe_path.as_deref().filter(|path| !path.is_empty()) {
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

    NativeGenerationResult {
        success: true,
        response_base64: None,
        encoded_vibes,
        error: None,
    }
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
            generate_image_with_references,
            generate_image_stream_with_references,
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
