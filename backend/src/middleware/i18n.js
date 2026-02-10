// backend/src/middleware/i18n.js

import { resolveLanguage, translate } from "../i18n/index.js";

export default function i18n(req, _res, next) {
  // language code like: "en", "sw", "pt"
  const lang = resolveLanguage(req);

  req.lang = lang;

  // req.t("key", {fallback:"..."})
  req.t = (key, vars = {}) => translate(lang, key, vars);

  next();
}