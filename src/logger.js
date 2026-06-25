"use strict";

/**
 * logger.js — tiny zero-dependency structured logger.
 *
 * - Levels: debug < info < warn < error < silent (set via LOG_LEVEL).
 * - Pretty by default; set LOG_JSON=true for machine-readable line-JSON.
 * - Always redacts secrets (API keys, private keys, long hex) before printing,
 *   so logs are safe to paste into a hackathon submission or CI output.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function ts() {
  return new Date().toISOString();
}

// Redact obvious secrets from any string value.
function redactString(s) {
  return String(s)
    .replace(/croo_sk_[A-Za-z0-9_]+/g, "croo_sk_***")
    .replace(/0x[0-9a-fA-F]{40,}/g, "0x***");
}

function redactMeta(meta) {
  try {
    return JSON.stringify(meta, (key, value) => {
      if (
        /(privatekey|private_key|secret|apikey|api_key|mnemonic|password)/i.test(
          key,
        )
      ) {
        return "***";
      }
      if (typeof value === "string") return redactString(value);
      return value;
    });
  } catch (_) {
    return "";
  }
}

class Logger {
  constructor(name = "app", level) {
    this.name = name;
    this.level =
      LEVELS[(level || process.env.LOG_LEVEL || "info").toLowerCase()] ??
      LEVELS.info;
    this.json = String(process.env.LOG_JSON || "").toLowerCase() === "true";
  }

  child(suffix) {
    const c = new Logger(`${this.name}:${suffix}`);
    c.level = this.level;
    c.json = this.json;
    return c;
  }

  _log(lvl, msg, meta) {
    if (LEVELS[lvl] < this.level) return;
    const stream = LEVELS[lvl] >= LEVELS.warn ? process.stderr : process.stdout;
    if (this.json) {
      const rec = { t: ts(), lvl, name: this.name, msg: redactString(msg) };
      if (meta && Object.keys(meta).length)
        rec.meta = JSON.parse(redactMeta(meta) || "{}");
      stream.write(JSON.stringify(rec) + "\n");
      return;
    }
    const tag = lvl.toUpperCase().padEnd(5);
    const extra =
      meta && Object.keys(meta).length ? "  " + redactMeta(meta) : "";
    stream.write(
      `${ts()} ${tag} [${this.name}] ${redactString(msg)}${extra}\n`,
    );
  }

  debug(msg, meta) {
    this._log("debug", msg, meta);
  }
  info(msg, meta) {
    this._log("info", msg, meta);
  }
  warn(msg, meta) {
    this._log("warn", msg, meta);
  }
  error(msg, meta) {
    this._log("error", msg, meta);
  }
  log(msg, meta) {
    this._log("info", msg, meta);
  }
}

module.exports = { Logger, LEVELS, redactString };
