"use client";

export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <main style={{ fontFamily: "system-ui", padding: "3rem", textAlign: "center" }}>
          <h1>Pulse is temporarily unavailable</h1>
          <p>Please refresh the page or try again shortly.</p>
        </main>
      </body>
    </html>
  );
}
