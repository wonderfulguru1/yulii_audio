# 🎙️ Audio Transcription API

A Next.js API that accepts audio files and transcribes them to text using OpenAI Whisper.
Designed to be called from a Flutter app.

---

## ⚡ Quick Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo
3. Add environment variable: `OPENAI_API_KEY` = your key
4. Deploy ✅

---

## 🔑 Getting an OpenAI API Key (for Whisper only)

> You only need this for Whisper transcription — not for GPT.
> Cost is ~$0.006 per minute of audio (very affordable).

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new key
3. Add it to Vercel: **Project → Settings → Environment Variables**

---

## 📦 Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up env
cp .env.local.example .env.local
# Edit .env.local and add your OPENAI_API_KEY

# 3. Run dev server
npm run dev

# API is now at: http://localhost:3000/api/transcribe
```

---

## 🌐 API Reference

### `POST /api/transcribe`

Transcribes an audio file to text.

**Request** — `multipart/form-data`

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `audio` | ✅ | File | Audio file to transcribe |
| `language` | ❌ | String | ISO-639-1 code: `en`, `fr`, `yo`, etc. |
| `response_format` | ❌ | String | `json` (default), `text`, `srt`, `vtt` |

**Supported formats:** mp3, mp4, m4a, wav, webm, ogg, flac  
**Max file size:** 25 MB

**Success Response (200)**
```json
{
  "success": true,
  "text": "Hello, this is the transcribed text.",
  "language": "en",
  "duration_seconds": 12.4,
  "file": {
    "name": "recording.mp3",
    "type": "audio/mpeg",
    "size_bytes": 204800
  }
}
```

**Error Response (4xx/5xx)**
```json
{
  "error": "No audio file found. Send the file under the field name \"audio\"."
}
```

### `GET /api/transcribe`

Health check — returns API info.

---

## 📱 Flutter Integration

### 1. Add dependencies to `pubspec.yaml`

```yaml
dependencies:
  http: ^1.2.0
  file_picker: ^8.0.0       # for picking files
  record: ^5.0.0             # for recording audio
  path: ^1.9.0
```

### 2. Transcription Service

Create `lib/services/transcription_service.dart`:

```dart
import 'dart:io';
import 'package:http/http.dart' as http;
import 'dart:convert';

class TranscriptionService {
  // ⚠️ Replace with your deployed Vercel URL
  static const String _baseUrl = 'https://your-app.vercel.app';

  /// Transcribes an audio file and returns the text.
  /// [audioFile] - the audio file to transcribe
  /// [language]  - optional ISO-639-1 code (e.g. 'en', 'yo', 'fr')
  static Future<TranscriptionResult> transcribe(
    File audioFile, {
    String? language,
  }) async {
    try {
      final uri = Uri.parse('$_baseUrl/api/transcribe');
      final request = http.MultipartRequest('POST', uri);

      // Attach the audio file under field name "audio"
      request.files.add(
        await http.MultipartFile.fromPath(
          'audio',
          audioFile.path,
        ),
      );

      // Optional: hint the language
      if (language != null) {
        request.fields['language'] = language;
      }

      // Send request
      final streamedResponse = await request.send().timeout(
        const Duration(seconds: 120),
      );
      final response = await http.Response.fromStream(streamedResponse);
      final body = jsonDecode(response.body) as Map<String, dynamic>;

      if (response.statusCode == 200 && body['success'] == true) {
        return TranscriptionResult.success(
          text: body['text'] as String,
          language: body['language'] as String?,
          durationSeconds: (body['duration_seconds'] as num?)?.toDouble(),
        );
      } else {
        return TranscriptionResult.error(
          message: body['error'] as String? ?? 'Unknown error',
          statusCode: response.statusCode,
        );
      }
    } on SocketException {
      return TranscriptionResult.error(message: 'No internet connection');
    } catch (e) {
      return TranscriptionResult.error(message: 'Error: $e');
    }
  }
}

/// Result model
class TranscriptionResult {
  final bool success;
  final String? text;
  final String? errorMessage;
  final int? statusCode;
  final String? language;
  final double? durationSeconds;

  const TranscriptionResult._({
    required this.success,
    this.text,
    this.errorMessage,
    this.statusCode,
    this.language,
    this.durationSeconds,
  });

  factory TranscriptionResult.success({
    required String text,
    String? language,
    double? durationSeconds,
  }) => TranscriptionResult._(
    success: true,
    text: text,
    language: language,
    durationSeconds: durationSeconds,
  );

  factory TranscriptionResult.error({
    required String message,
    int? statusCode,
  }) => TranscriptionResult._(
    success: false,
    errorMessage: message,
    statusCode: statusCode,
  );
}
```

### 3. Example Usage in Flutter Widget

```dart
import 'package:file_picker/file_picker.dart';
import 'services/transcription_service.dart';

// Pick a file and transcribe it
Future<void> transcribeAudioFile() async {
  // Pick audio file
  final result = await FilePicker.platform.pickFiles(
    type: FileType.audio,
    allowMultiple: false,
  );

  if (result == null || result.files.single.path == null) return;

  final file = File(result.files.single.path!);

  setState(() => _isLoading = true);

  final transcription = await TranscriptionService.transcribe(
    file,
    language: 'en', // optional
  );

  setState(() => _isLoading = false);

  if (transcription.success) {
    print('Transcribed text: ${transcription.text}');
  } else {
    print('Error: ${transcription.errorMessage}');
  }
}
```

### 4. Recording & Transcribing Live Audio

```dart
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';

final _recorder = AudioRecorder();
String? _recordingPath;

// Start recording
Future<void> startRecording() async {
  if (await _recorder.hasPermission()) {
    final dir = await getTemporaryDirectory();
    _recordingPath = '${dir.path}/recording_${DateTime.now().millisecondsSinceEpoch}.m4a';
    
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc),
      path: _recordingPath!,
    );
  }
}

// Stop and transcribe
Future<void> stopAndTranscribe() async {
  await _recorder.stop();
  
  if (_recordingPath != null) {
    final result = await TranscriptionService.transcribe(
      File(_recordingPath!),
    );
    
    if (result.success) {
      // Use result.text
    }
  }
}
```

---

## ⚠️ Vercel Limits to Know

| Plan | Timeout | Notes |
|------|---------|-------|
| Hobby (free) | 10s | ❌ Too short for most audio |
| Pro ($20/mo) | 60s | ✅ Works for files up to ~10 min |

> For the Hobby plan, keep audio under ~30 seconds.  
> For production, upgrade to Pro and the included `vercel.json` sets `maxDuration: 60`.

---

## 🗂️ Project Structure

```
transcribe-api/
├── app/
│   ├── api/
│   │   └── transcribe/
│   │       └── route.ts        ← The API endpoint
│   ├── layout.tsx
│   └── page.tsx                ← Simple docs page
├── .env.local.example          ← Copy to .env.local
├── vercel.json                 ← Sets 60s timeout
├── next.config.js
└── package.json
```
# yulii_audio
