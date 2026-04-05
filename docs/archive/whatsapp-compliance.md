# WhatsApp Compliance Checklist

## 1. Phone number identity (`phone_number_id`)

- Always trim the incoming value before use.
- Validate against `^\d{8,30}$`. Invalid values now trigger `WA_INVALID_PHONE_NUMBER_ID` and throw before any HTTP call.
- Logs include:
  - `urlPath` (`/{phone_number_id}/messages`)
  - `phoneNumberIdRawSnippet` (up to 48 chars)
  - `phoneNumberIdDigitsLast4`
  - `phoneNumberIdHasNonDigit`

## 2. Destination normalization (`to`)

- Normalize to digits only via `ensureValidToDigits`.
- Require at least 10 digits (E.164 without “+”).
- Errors surface immediately with clear messages before the HTTP payload is built.

## 3. Sticker upload (`/media`)

- Download the supplied URL; if the response is non-200 the request fails fast.
- Validate that the payload:
  - Is of type WEBP (`RIFF....WEBP` magic bytes).
  - Does not exceed **1 MiB** (1,048,576 bytes).
  - Has a `Content-Type` header that includes `webp`.
- Upload uses the actual MIME as the `type` form field (not the literal string `sticker`).
- Cached `mediaId` documents capture `host`, `path`, `hash`, `sizeBytes`, and `fbTraceId`.
- Any validation failure records `outboundMessages` with a failing status and reason.

## 4. Sticker send

- HTTPS links are downloaded → validated → uploaded → sent by `sticker.id`.
- Plain IDs bypass download and go straight to `sticker.id`.
- Rate/spam/pair limits still receive classification so we can throttle/fallback appropriately.

## 5. Diagnostic flow

1. Check logs:
   - `WA_CALL_URL_INFO` shows path, sanitized phone number, and unexpected characters.
   - `WhatsApp API OK / HTTP ERROR / NETWORK ERROR` include `fbTraceId` and sanitized `toLast4`.
   - `WA_STICKER_LIMIT_HIT` and `WA_STICKER_THROTTLED` surface upstream issues.
2. Inspect `outboundMessages`: `status`, `errorCode`, `errorMessage`, `fbTraceId`, `type`, `strategy`.
3. For upload issues, look for `WA_MEDIA_CACHE_HIT`/`WA_MEDIA_UPLOAD_OK` and `WA_MEDIA_UPLOAD_FAILED`.

## FAQ

- **Why 1 MiB limit?** Meta requires WEBP stickers <= 1 MB for reliable delivery.
- **Still seeing 131053?** The sticker URL likely failed the download/validation step before hitting `mediaId`.
- **How to add new diagnostics?** Extend `WA_CALL_URL_INFO` or `WA_MEDIA_UPLOAD_*` logs with sanitized context; never log raw tokens or full numbers.
