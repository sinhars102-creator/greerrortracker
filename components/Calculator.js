"use client";

import { useState } from "react";
import { evaluateExpression } from "@/lib/calc";

const COLORS = {
  panel: "#C6C6C6",
  displayBg: "#EFEFEF",
  displayText: "#1E1E1E",
  navy: "#27435C",
  blue: "#2E6C97",
  rust: "#A8461E",
  disabled: "#B7B7B7",
  disabledText: "#8A8A8A",
  white: "#FFFFFF",
  darkText: "#222222",
};

function formatNumber(n) {
  if (!Number.isFinite(n)) return "Error";
  const rounded = Math.round(n * 1e10) / 1e10;
  return String(rounded);
}

function toEvalString(expr) {
  return expr.replaceAll("×", "*").replaceAll("÷", "/");
}

const btnBase = {
  border: "none", borderRadius: 8, fontSize: 22, cursor: "pointer",
  padding: "14px 0", boxShadow: "0 2px 0 rgba(0,0,0,0.2)", fontFamily: "inherit",
};

function Btn({ label, onClick, bg, color, disabled, small }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...btnBase,
        background: disabled ? COLORS.disabled : bg,
        color: disabled ? COLORS.disabledText : color,
        fontSize: small ? 15 : 22,
        cursor: disabled ? "default" : "pointer",
        boxShadow: disabled ? "none" : btnBase.boxShadow,
      }}
    >
      {label}
    </button>
  );
}

export default function Calculator() {
  const [expr, setExpr] = useState("");
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [memory, setMemory] = useState(0);

  const openCount = (expr.match(/\(/g) || []).length;
  const closeCount = (expr.match(/\)/g) || []).length;
  const canCloseParen = openCount > closeCount;
  const display = expr === "" ? "0." : expr === "Error" ? "Error" : expr;

  const inputDigit = (d) => {
    if (justEvaluated) { setExpr(d); setJustEvaluated(false); return; }
    setExpr((prev) => (prev === "Error" ? d : prev + d));
  };

  const inputDecimal = () => {
    if (justEvaluated) { setExpr("0."); setJustEvaluated(false); return; }
    setExpr((prev) => {
      if (prev === "Error") return "0.";
      const seg = prev.split(/[+\-×÷(]/).pop();
      if (seg.includes(".")) return prev;
      return prev === "" || /[+\-×÷(]$/.test(prev) ? prev + "0." : prev + ".";
    });
  };

  const inputOperator = (op) => {
    setJustEvaluated(false);
    setExpr((prev) => {
      if (prev === "Error") return "";
      if (prev === "") return op === "-" ? "-" : "";
      if (/[+\-×÷]$/.test(prev)) {
        if (op === "-" && !prev.endsWith("-")) return prev + op;
        return prev.slice(0, -1) + op;
      }
      return prev + op;
    });
  };

  const inputOpenParen = () => {
    setJustEvaluated(false);
    setExpr((prev) => (prev === "Error" ? "(" : prev + "("));
  };

  const inputCloseParen = () => {
    if (!canCloseParen) return;
    setJustEvaluated(false);
    setExpr((prev) => prev + ")");
  };

  const clearAll = () => { setExpr(""); setJustEvaluated(false); };
  const clearEntry = () => setExpr((prev) => prev.replace(/(\d+\.?\d*|\.\d+)$/, ""));

  const toggleSign = () => {
    setExpr((prev) => {
      const m = prev.match(/(\d+\.?\d*)$/);
      if (!m) return prev;
      const numStr = m[0];
      const idx = prev.length - numStr.length;
      const before = prev.slice(0, idx);
      const charBeforeMinus = before[idx - 2];
      if (before.endsWith("-") && (idx < 2 || /[+\-×÷(]/.test(charBeforeMinus))) {
        return before.slice(0, -1) + numStr;
      }
      return before + "-" + numStr;
    });
  };

  const equals = () => {
    try {
      const val = evaluateExpression(toEvalString(expr));
      setExpr(formatNumber(val));
    } catch {
      setExpr("Error");
    }
    setJustEvaluated(true);
  };

  const applySqrt = () => {
    try {
      const val = expr === "" ? 0 : evaluateExpression(toEvalString(expr));
      if (val < 0) throw new Error("negative");
      setExpr(formatNumber(Math.sqrt(val)));
    } catch {
      setExpr("Error");
    }
    setJustEvaluated(true);
  };

  const memoryClear = () => setMemory(0);
  const memoryRecall = () => {
    if (justEvaluated) { setExpr(formatNumber(memory)); setJustEvaluated(false); return; }
    setExpr((prev) => (prev === "Error" ? formatNumber(memory) : prev + formatNumber(memory)));
  };
  const memoryAdd = () => {
    try {
      const val = expr === "" ? 0 : evaluateExpression(toEvalString(expr));
      setMemory((m) => m + val);
    } catch { /* ignore malformed expression, memory unchanged */ }
  };

  return (
    <div style={{
      background: COLORS.panel, borderRadius: 16, padding: 16, width: 260,
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    }}>
      <div style={{
        background: COLORS.displayBg, borderRadius: 6, padding: "14px 12px", marginBottom: 12,
        textAlign: "right", fontSize: 28, color: COLORS.displayText, fontFamily: "monospace",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {display}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        <Btn label="MR" onClick={memoryRecall} bg={COLORS.navy} color={COLORS.white} small />
        <Btn label="MC" onClick={memoryClear} bg={COLORS.navy} color={COLORS.white} small />
        <Btn label="M+" onClick={memoryAdd} bg={COLORS.navy} color={COLORS.white} small />
        <Btn label="(" onClick={inputOpenParen} bg={COLORS.blue} color={COLORS.white} />
        <Btn label=")" onClick={inputCloseParen} bg={COLORS.blue} color={COLORS.white} disabled={!canCloseParen} />

        <Btn label="7" onClick={() => inputDigit("7")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="8" onClick={() => inputDigit("8")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="9" onClick={() => inputDigit("9")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="÷" onClick={() => inputOperator("÷")} bg={COLORS.blue} color={COLORS.white} />
        <Btn label="C" onClick={clearAll} bg={COLORS.rust} color={COLORS.white} />

        <Btn label="4" onClick={() => inputDigit("4")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="5" onClick={() => inputDigit("5")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="6" onClick={() => inputDigit("6")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="×" onClick={() => inputOperator("×")} bg={COLORS.blue} color={COLORS.white} />
        <Btn label="CE" onClick={clearEntry} bg={COLORS.rust} color={COLORS.white} />

        <Btn label="1" onClick={() => inputDigit("1")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="2" onClick={() => inputDigit("2")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="3" onClick={() => inputDigit("3")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="-" onClick={() => inputOperator("-")} bg={COLORS.blue} color={COLORS.white} />
        <Btn label="√" onClick={applySqrt} bg={COLORS.blue} color={COLORS.white} />

        <Btn label="±" onClick={toggleSign} bg={COLORS.blue} color={COLORS.white} />
        <Btn label="0" onClick={() => inputDigit("0")} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="." onClick={inputDecimal} bg={COLORS.white} color={COLORS.darkText} />
        <Btn label="+" onClick={() => inputOperator("+")} bg={COLORS.blue} color={COLORS.white} />
        <Btn label="=" onClick={equals} bg={COLORS.navy} color={COLORS.white} />
      </div>
    </div>
  );
}
