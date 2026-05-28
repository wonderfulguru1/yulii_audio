export default function Home() {
  return (
    <main style={{ fontFamily: "monospace", padding: "2rem", maxWidth: 700 }}>
      <h1>🎙️ Audio Transcription API</h1>
      <p>Powered by OpenAI Whisper · Hosted on Vercel</p>

      <hr />

      <h2>POST /api/transcribe</h2>
      <p>Accepts a multipart/form-data request with an audio file.</p>

      <h3>Fields</h3>
      <table border={1} cellPadding={8} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr><th>Field</th><th>Required</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td>audio</td><td>✅ Yes</td><td>The audio file to transcribe</td></tr>
          <tr><td>language</td><td>❌ No</td><td>ISO-639-1 language code (e.g. en, fr, yo)</td></tr>
          <tr><td>response_format</td><td>❌ No</td><td>json (default), text, srt, vtt</td></tr>
        </tbody>
      </table>

      <h3>Supported Formats</h3>
      <p>mp3, mp4, m4a, wav, webm, ogg, flac · Max 25 MB</p>

      <h3>Example Response</h3>
      <pre style={{ background: "#f4f4f4", padding: "1rem" }}>{`{
  "success": true,
  "text": "Hello, this is the transcribed text.",
  "language": "en",
  "file": {
    "name": "recording.mp3",
    "type": "audio/mpeg",
    "size_bytes": 204800
  }
}`}</pre>
    </main>
  );
}
