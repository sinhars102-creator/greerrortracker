"use client";

import { useEffect } from "react";

export default function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 32, cursor: "zoom-out",
      }}
    >
      <img
        src={src}
        alt={alt || "Full-size preview"}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 6, boxShadow: "0 8px 40px rgba(0,0,0,0.6)", cursor: "default" }}
      />
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute", top: 20, right: 24, width: 34, height: 34, borderRadius: 5,
          background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 18, cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}
