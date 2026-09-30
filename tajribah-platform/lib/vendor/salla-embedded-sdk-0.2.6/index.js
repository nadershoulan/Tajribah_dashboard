const u = "embedded::", q = {
  /** Initialize handshake - iframe signals it's ready to receive context */
  INIT: `${u}iframe.ready`,
  /** App signals it's fully loaded and ready */
  READY: `${u}ready`,
  /** App requests to be destroyed and navigate away */
  DESTROY: `${u}destroy`
}, U = {
  /** Context data provision */
  PROVIDE: `${u}context.provide`,
  /** Theme change notification */
  THEME_CHANGE: `${u}theme.change`
}, g = {
  /** Set loading state */
  LOADING: `${u}ui.loading`,
  /** Set breadcrumbs visibility state */
  BREADCRUMBS: `${u}ui.breadcrumbs`,
  /** Show toast notification */
  TOAST: `${u}ui.toast`,
  /** Show confirm dialog (async request) */
  CONFIRM: `${u}ui.confirm`,
  /** Confirm dialog response (from host) */
  CONFIRM_RESPONSE: `${u}ui.confirm.response`
}, Z = {}, X = {
  /** Request token refresh (re-renders iframe with new token) */
  REFRESH: `${u}auth.refresh`
}, T = {
  /** Navigate using React Router (SPA navigation) */
  NAVIGATE: `${u}page.navigate`,
  /** Redirect using window.location (full page reload) */
  REDIRECT: `${u}page.redirect`,
  /** Set page title */
  SET_TITLE: `${u}page.setTitle`
}, h = {
  /** Set primary action button in navbar */
  SET_ACTION: `${u}nav.setAction`,
  /** Clear the primary action button */
  CLEAR_ACTION: `${u}nav.clearAction`,
  /** Notification when action button is clicked (host → iframe) */
  ACTION_CLICK: `${u}nav.actionClick`,
  /** Add one sub-navigation item (iframe → host) */
  ADD_ITEM: `${u}nav.addItem`,
  /** Ack with `value` and deprecated `id` (same string) (host → iframe; request response) */
  ADD_ITEM_RESPONSE: `${u}nav.addItem.response`,
  UPDATE_ITEM: `${u}nav.updateItem`,
  REMOVE_ITEM: `${u}nav.removeItem`,
  /** Injected sub-nav item clicked (host → iframe) */
  ITEM_CLICK: `${u}nav.itemClick`
}, y = {
  /** Create checkout flow */
  CREATE: `${u}checkout.create`,
  /** Checkout response from host */
  RESPONSE: `${u}checkout.response`,
  /** Get available addons for the app */
  GET_ADDONS: `${u}checkout.getAddons`,
  /** Get addons response from host */
  GET_ADDONS_RESPONSE: `${u}checkout.getAddons.response`,
  /** Reset checkout cache on host */
  RESET_CACHE: `${u}checkout.resetCache`
}, D = Z.version || "", ee = 1e4, te = [
  "localhost",
  "merchants.workers.dev",
  "s.salla.sa",
  ".salla.group",
  ".salla.sa"
], re = /* @__PURE__ */ new Set([
  "ar",
  // Arabic
  "he",
  // Hebrew
  "fa",
  // Persian / Farsi
  "ur",
  // Urdu
  "ps",
  // Pashto
  "sd",
  // Sindhi
  "yi"
  // Yiddish
]);
function ie(t) {
  const e = (t ?? "ar").toLowerCase().split(/[-_]/)[0];
  return re.has(e) ? "rtl" : "ltr";
}
let N = {
  showVersion: !0,
  debug: !1
};
function ne(t) {
  N = { ...N, ...t };
}
function P(t) {
  return `%c${t}`;
}
function j(t, e = "#fff") {
  return `background-color: ${t}; color: ${e}; padding: 2px 6px; border-radius: 3px; font-weight: 500; font-size: 11px;`;
}
function S(t, ...e) {
  if (t === "debug" && !N.debug)
    return;
  const r = [], i = [];
  r.push(P("EmbeddedSDK")), i.push(j("#10b981", "#fff")), N.showVersion && (r.push(P(`v${D}`)), i.push(j("#6b7280", "#fff")));
  const n = r.join("").trim();
  (console[t] || console.log)(n, ...i, ...e);
}
const o = {
  log: (...t) => {
    S("log", ...t);
  },
  warn: (...t) => {
    S("warn", ...t);
  },
  error: (...t) => {
    S("error", ...t);
  },
  info: (...t) => {
    S("info", ...t);
  },
  debug: (...t) => {
    S("debug", ...t);
  }
};
function se(t) {
  try {
    const r = new URL(t).hostname;
    return te.some((i) => i.startsWith(".") ? r.endsWith(i) || r === i.slice(1) : r === i || r.startsWith(`${i}:`));
  } catch {
    return !1;
  }
}
function ae() {
  return typeof window > "u" || window.parent === window ? null : window.parent;
}
function c(t, e, r = "*", i, n) {
  const s = ae();
  if (!s) {
    o.warn("Not running in an iframe, cannot post to host");
    return;
  }
  const a = {
    event: t,
    payload: e || {},
    timestamp: Date.now(),
    source: "embedded-app",
    ...i && { requestId: i },
    metadata: {
      version: D
    }
  };
  s.postMessage(a, r);
}
const v = /* @__PURE__ */ new Map();
let $ = !1;
function W(t) {
  if (process.env.NODE_ENV === "production" && !se(t.origin))
    return;
  const e = t.data;
  if (!e || typeof e.event != "string" || !e.payload || typeof e.timestamp != "number" || !e.source) {
    o.warn("Invalid message structure received:", e);
    return;
  }
  const r = v.get(e.event);
  r && r.forEach((n) => {
    try {
      n(e);
    } catch (s) {
      o.error("Error in message handler:", s);
    }
  });
  const i = v.get("*");
  i && i.forEach((n) => {
    try {
      n(e);
    } catch (s) {
      o.error("Error in wildcard handler:", s);
    }
  });
}
function oe() {
  $ || typeof window > "u" || (window.addEventListener("message", W), $ = !0);
}
function b(t, e) {
  oe(), v.has(t) || v.set(t, /* @__PURE__ */ new Set());
  const r = v.get(t);
  return r.add(e), () => {
    r.delete(e), r.size === 0 && v.delete(t);
  };
}
function ue(t, e = ee) {
  return new Promise((r, i) => {
    const n = setTimeout(() => {
      s(), i(new Error(`[EmbeddedSDK] Timeout waiting for "${t}" message`));
    }, e), s = b(t, (a) => {
      clearTimeout(n), s(), r(a);
    });
  });
}
function de() {
  v.clear(), $ && typeof window < "u" && (window.removeEventListener("message", W), $ = !1);
}
function ce() {
  return typeof window > "u" ? !1 : window.parent !== window;
}
function le(t, e, r) {
  const i = {
    event: t,
    payload: e,
    timestamp: Date.now(),
    source: "merchant-dashboard",
    ...r,
    metadata: { version: D, synthetic: !0 }
  };
  v.get(t)?.forEach((s) => {
    try {
      s(i);
    } catch (a) {
      o.error("Error in message handler:", a);
    }
  });
}
const E = /* @__PURE__ */ new Map(), fe = 3e4;
function Y() {
  const t = Date.now(), e = Math.random().toString(36).slice(2, 9);
  return `req_${t}_${e}`;
}
function x(t, e = {}, r = fe) {
  const i = Y();
  return new Promise((n, s) => {
    const a = setTimeout(() => {
      E.get(i) && (E.delete(i), s(
        new Error(
          `[EmbeddedSDK] Request "${t}" timed out after ${r}ms`
        )
      ));
    }, r);
    E.set(i, {
      resolve: n,
      reject: s,
      timeout: a,
      event: t
    }), c(t, e, "*", i);
  });
}
function C(t, e, r) {
  const i = E.get(t);
  if (!i) {
    o.warn(`Received response for unknown request: ${t}`);
    return;
  }
  clearTimeout(i.timeout), E.delete(t), r ? i.reject(new Error(r)) : i.resolve(e);
}
function he(t = "SDK cleanup") {
  E.forEach((e, r) => {
    clearTimeout(e.timeout), e.reject(
      new Error(`[EmbeddedSDK] Request ${r} cancelled: ${t}`)
    );
  }), E.clear();
}
function A() {
  const t = /* @__PURE__ */ new Set();
  return {
    subscribe(e) {
      return t.add(e), () => {
        t.delete(e);
      };
    },
    notify(...e) {
      t.forEach((r) => {
        try {
          r(...e);
        } catch (i) {
          o.error("Error in subscription callback:", i);
        }
      });
    },
    clear() {
      t.clear();
    },
    size() {
      return t.size;
    }
  };
}
const me = "https://api.salla.dev";
class w extends Error {
  constructor(e, r, i) {
    super(e), this.status = r, this.response = i, this.name = "ApiError";
  }
}
async function pe(t, e = {}) {
  const { method: r = "GET", headers: i = {}, body: n, timeout: s = 3e4 } = e, a = `${me}${t}`, l = new AbortController(), f = setTimeout(() => {
    l.abort();
  }, s);
  try {
    const d = await fetch(a, {
      method: r,
      headers: {
        "Content-Type": "application/json",
        ...i
      },
      body: n ? JSON.stringify(n) : void 0,
      signal: l.signal
    });
    clearTimeout(f);
    let m;
    if (d.headers.get("content-type")?.includes("application/json") ? m = await d.json() : m = await d.text(), !d.ok)
      throw new w(
        `API request failed: ${d.statusText}`,
        d.status,
        m
      );
    return m;
  } catch (d) {
    throw clearTimeout(f), d instanceof w ? d : d instanceof Error ? d.name === "AbortError" ? new w(`Request timeout after ${s}ms`) : new w(`Request failed: ${d.message}`) : new w("Unknown error occurred");
  }
}
function k(t) {
  return {
    isVerified: !1,
    isError: !0,
    error: t,
    data: null
  };
}
async function ge(t) {
  const { token: e, appId: r, refreshOnError: i = !0 } = t;
  if (!e) {
    const n = "Token is required. Provide it as a parameter or in URL as ?token=XXX";
    return o.error("Error in introspect:", n), k(n);
  }
  if (!r) {
    const n = "App ID is required. Provide it as a parameter or in URL as ?app_id=XXX";
    return o.error("Error in introspect:", n), k(n);
  }
  try {
    const n = await pe(
      "/exchange-authority/v1/introspect",
      {
        method: "POST",
        headers: {
          "S-Source": r,
          "Content-Type": "application/json"
        },
        body: {
          env: "prod",
          token: e,
          iss: "merchant-dashboard",
          subject: "embedded-page"
        }
      }
    ), s = n.success;
    return {
      isVerified: s,
      isError: !s,
      error: s ? void 0 : "API request failed",
      data: s ? n.data : null
    };
  } catch (n) {
    i && (J().ui.toast.error(n?.toString() ?? "Introspect error"), c(X.REFRESH, {})), o.error("Error in introspect:", n);
    const s = n instanceof Error ? n.message : n;
    return k(s);
  }
}
function ve(t) {
  return {
    /**
     * Get the token from the URL query parameter.
     * The token is passed to the iframe via ?token=XXX
     *
     * @example
     * ```typescript
     * const token = embedded.auth.getToken();
     * if (token) {
     *   await verifyWithBackend(token);
     * }
     * ```
     */
    getToken() {
      return new URLSearchParams(window.location.search).get("token");
    },
    /**
     * Get the app ID from the URL query parameter.
     * The app ID is passed to the iframe via ?app_id=XXX
     */
    getAppId() {
      return new URLSearchParams(window.location.search).get("app_id");
    },
    /**
     * Request a token refresh from the host.
     * This will re-render the iframe with a new token URL.
     *
     * @example
     * ```typescript
     * // When token is about to expire
     * embedded.auth.refresh();
     * ```
     */
    refresh() {
      c(X.REFRESH, {});
    },
    /**
     * Introspect (verify) a short-lived token with Salla's API.
     * This method verifies the token and returns token information.
     *
     * @param options - Optional parameters (appId, token, and refreshOnError). If not provided, will be extracted from URL params.
     * @returns Promise that resolves with the introspect response. On API error, resolves with isVerified: false, isError: true, and empty data.
     */
    async introspect(e = {}) {
      const r = e.token ?? this.getToken() ?? "", i = e.appId ?? this.getAppId() ?? "";
      return ge({
        token: r,
        appId: i,
        refreshOnError: e.refreshOnError
      });
    }
  };
}
const F = ["success", "error", "warning", "info"];
function be(t) {
  const e = [];
  return t.type === void 0 || t.type === null ? e.push("Toast type is required") : (typeof t.type != "string" || !F.includes(t.type)) && e.push(
    `Invalid toast type "${t.type}". Expected: ${F.join(" | ")}`
  ), t.message === void 0 || t.message === null ? e.push("Toast message is required") : typeof t.message != "string" ? e.push("Toast message must be a string") : t.message.trim() === "" && e.push("Toast message cannot be empty"), t.duration !== void 0 && t.duration !== null && (typeof t.duration != "number" ? e.push("Toast duration must be a number") : t.duration < 0 && e.push("Toast duration cannot be negative")), { valid: e.length === 0, errors: e };
}
function H(t, e) {
  const r = [];
  return typeof t != "object" || t === null ? (r.push(`${e} must be an object`), r) : ((typeof t.type != "string" || t.type.trim() === "") && r.push(`${e} must have a valid type`), (typeof t.slug != "string" || t.slug.trim() === "") && r.push(`${e} must have a valid slug`), t.quantity !== void 0 && (typeof t.quantity != "number" || t.quantity < 1) && r.push(`${e} must have a quantity >= 1`), r);
}
function ye(t) {
  const e = [];
  if (typeof t != "object" || t === null)
    return e.push("Checkout options must be an object"), { valid: !1, errors: e };
  const r = "item" in t, i = "items" in t;
  if (!r && !i)
    return e.push("Checkout requires either 'item' or 'items'"), { valid: !1, errors: e };
  if (r) {
    const n = H(
      t.item,
      "Item"
    );
    return e.push(...n), { valid: e.length === 0, errors: e };
  }
  return Array.isArray(t.items) ? t.items.length === 0 ? (e.push("At least one item is required"), { valid: !1, errors: e }) : (t.items.forEach((n, s) => {
    const a = H(
      n,
      `Item at index ${s}`
    );
    e.push(...a);
  }), { valid: e.length === 0, errors: e }) : (e.push("Checkout items must be an array"), { valid: !1, errors: e });
}
function Ee(t) {
  const e = [];
  return t.path === void 0 || t.path === null ? e.push("Navigation path is required") : typeof t.path != "string" ? e.push("Navigation path must be a string") : t.path.trim() === "" && e.push("Navigation path cannot be empty"), t.replace !== void 0 && typeof t.replace != "boolean" && e.push("Navigation replace option must be a boolean"), { valid: e.length === 0, errors: e };
}
function Te(t) {
  const e = [];
  if (t.url === void 0 || t.url === null)
    e.push("Redirect URL is required");
  else if (typeof t.url != "string")
    e.push("Redirect URL must be a string");
  else if (t.url.trim() === "")
    e.push("Redirect URL cannot be empty");
  else
    try {
      new URL(t.url);
    } catch {
      e.push(`Invalid redirect URL: "${t.url}"`);
    }
  return { valid: e.length === 0, errors: e };
}
function Ie(t) {
  const e = [];
  return t.title ? typeof t.title != "string" && e.push("Nav action title must be a string") : e.push("Nav action title is required"), t.value ? typeof t.value != "string" && e.push("Nav action value must be a string") : e.push("Nav action value is required"), t.subTitle !== void 0 && t.subTitle !== null && typeof t.subTitle != "string" && e.push("Nav action subTitle must be a string"), t.icon !== void 0 && t.icon !== null && typeof t.icon != "string" && e.push("Nav action icon must be a string"), t.disabled !== void 0 && t.disabled !== null && typeof t.disabled != "boolean" && e.push("Nav action disabled must be a boolean"), t.extendedActions !== void 0 && t.extendedActions !== null && (Array.isArray(t.extendedActions) ? t.extendedActions.forEach((r, i) => {
    if (typeof r != "object" || r === null) {
      e.push(`Extended action at index ${i} must be an object`);
      return;
    }
    const n = r;
    (!n.title || typeof n.title != "string") && e.push(
      `Extended action at index ${i} is missing required "title" property`
    ), (!n.value || typeof n.value != "string") && e.push(
      `Extended action at index ${i} is missing required "value" property`
    ), n.subTitle !== void 0 && typeof n.subTitle != "string" && e.push(
      `Extended action at index ${i} subTitle must be a string`
    ), n.icon !== void 0 && typeof n.icon != "string" && e.push(
      `Extended action at index ${i} icon must be a string`
    ), n.disabled !== void 0 && typeof n.disabled != "boolean" && e.push(
      `Extended action at index ${i} disabled must be a boolean`
    );
  }) : e.push("Nav action extendedActions must be an array")), { valid: e.length === 0, errors: e };
}
const _ = 50;
function R(t, e) {
  return t ? `${t}.${e}` : e;
}
function Se(t, e) {
  const r = [];
  ["title", "value", "url"].forEach((s) => {
    (typeof t[s] != "string" || !String(t[s]).trim()) && r.push(
      `Sub-nav addItem "${R(e, s)}" must be non-empty string`
    );
  });
  const i = R(e, "disabled"), n = R(e, "active");
  return t.disabled !== void 0 && typeof t.disabled != "boolean" && r.push(`Sub-nav addItem "${i}" must be boolean`), t.active !== void 0 && typeof t.active != "boolean" && r.push(`Sub-nav addItem "${n}" must be boolean`), r;
}
function z(t, e, r) {
  if (typeof t != "object" || t === null)
    return [`Sub-nav addItem "${e || "item"}" must be an object`];
  const i = t, n = Se(i, e), s = R(e, "children");
  return i.children === void 0 ? n : r ? Array.isArray(i.children) ? i.children.length > _ ? (n.push(
    `Sub-nav addItem "${s}" must have at most ${_} items`
  ), n) : (i.children.forEach((a, l) => {
    const f = e ? `${e}.children[${l}]` : `children[${l}]`;
    n.push(...z(a, f, !1));
  }), n) : (n.push(`Sub-nav addItem "${s}" must be an array`), n) : (Array.isArray(i.children) && i.children.length === 0 || n.push(
    `Sub-nav addItem "${s}" is not supported on submenu rows (only one dropdown level)`
  ), n);
}
function Q(t, e, r, i) {
  if (typeof t != "object" || t === null)
    return i;
  const n = t;
  return typeof n.value == "string" && n.value.trim() && i.push(n.value.trim()), !r || !Array.isArray(n.children) || n.children.forEach((s, a) => {
    const l = e ? `${e}.children[${a}]` : `children[${a}]`;
    Q(s, l, !1, i);
  }), i;
}
function we(t) {
  const e = Q(t, "", !0, []), r = /* @__PURE__ */ new Set(), i = [];
  for (const n of e)
    r.has(n) && i.push(n), r.add(n);
  return i.length === 0 ? [] : [
    `Sub-nav addItem "value" must be globally unique within the item tree (duplicate: ${[...new Set(i)].join(", ")})`
  ];
}
function Ae(t) {
  if (typeof t != "object" || t === null)
    return {
      valid: !1,
      errors: ["Nav addItem expects an object item"]
    };
  const e = [
    ...z(t, "", !0),
    ...we(t)
  ];
  return { valid: e.length === 0, errors: e };
}
function Re(t) {
  const e = [];
  if (typeof t != "object" || t === null)
    return e.push("Nav updateItem expects an object item"), { valid: !1, errors: e };
  const r = t, i = typeof r.value == "string" && String(r.value).trim().length > 0, n = typeof r.id == "string" && String(r.id).trim().length > 0, s = i ? String(r.value).trim() : "", a = n ? String(r.id).trim() : "";
  if (!i && !n)
    return e.push('Sub-nav updateItem requires non-empty string "value"'), { valid: !1, errors: e };
  if (i && n && s !== a)
    return e.push(
      'Sub-nav updateItem must not specify different "id" and "value"; "value" is the immutable row key and cannot be renamed via patch'
    ), { valid: !1, errors: e };
  const l = s || a;
  let f = 0;
  if (r.title !== void 0 && f++, r.url !== void 0 && f++, r.disabled !== void 0 && f++, r.active !== void 0 && f++, r.children !== void 0 && f++, f === 0)
    return e.push(
      "Sub-nav updateItem must include at least one of title, url, disabled, active, children"
    ), { valid: !1, errors: e };
  if (["title", "url"].forEach((d) => {
    r[d] !== void 0 && (typeof r[d] != "string" || !r[d].trim()) && e.push(`Sub-nav updateItem "${d}" must be non-empty`);
  }), r.disabled !== void 0 && typeof r.disabled != "boolean" && e.push('Sub-nav updateItem "disabled" must be boolean'), r.active !== void 0 && typeof r.active != "boolean" && e.push('Sub-nav updateItem "active" must be boolean'), r.children !== void 0)
    if (!Array.isArray(r.children))
      e.push('Sub-nav updateItem "children" must be an array');
    else if (r.children.length > _)
      e.push(
        `Sub-nav updateItem "children" must have at most ${_} items`
      );
    else {
      const d = /* @__PURE__ */ new Set();
      r.children.forEach((m, V) => {
        const M = `children[${V}]`;
        if (e.push(...z(m, M, !1)), typeof m == "object" && m !== null) {
          const O = m.value;
          if (typeof O == "string" && O.trim()) {
            const L = O.trim();
            L === l && e.push(
              `Sub-nav updateItem "${M}.value" must not equal the parent row identifier`
            ), d.has(L) && e.push(
              `Sub-nav updateItem "${M}.value" must be unique within children`
            ), d.add(L);
          }
        }
      });
    }
  return { valid: e.length === 0, errors: e };
}
function Ne(t) {
  const e = [];
  return (typeof t != "string" || !t.trim()) && e.push("Nav removeItem value must be non-empty string"), { valid: e.length === 0, errors: e };
}
const K = ["danger", "warning", "info"];
function $e(t) {
  const e = [];
  return t.title === void 0 || t.title === null ? e.push("Confirm dialog title is required") : typeof t.title != "string" ? e.push("Confirm dialog title must be a string") : t.title.trim() === "" && e.push("Confirm dialog title cannot be empty"), t.message === void 0 || t.message === null ? e.push("Confirm dialog message is required") : typeof t.message != "string" ? e.push("Confirm dialog message must be a string") : t.message.trim() === "" && e.push("Confirm dialog message cannot be empty"), t.confirmText !== void 0 && t.confirmText !== null && typeof t.confirmText != "string" && e.push("Confirm dialog confirmText must be a string"), t.cancelText !== void 0 && t.cancelText !== null && typeof t.cancelText != "string" && e.push("Confirm dialog cancelText must be a string"), t.variant !== void 0 && t.variant !== null && (typeof t.variant != "string" || !K.includes(t.variant)) && e.push(
    `Invalid confirm variant "${t.variant}". Expected: ${K.join(" | ")}`
  ), { valid: e.length === 0, errors: e };
}
function p(t, e) {
  o.error(
    `Validation failed for ${t}:
` + e.map((r) => `  • ${r}`).join(`
`)
  );
}
function Ce() {
  return { resize: (i) => {
  }, autoResize: () => {
  }, stopAutoResize: () => {
  } };
}
function _e() {
  const { resize: t, autoResize: e, stopAutoResize: r } = Ce();
  return {
    navigate(i, n) {
      const s = Ee({ path: i, ...n });
      if (!s.valid) {
        p(T.NAVIGATE, s.errors);
        return;
      }
      c(T.NAVIGATE, {
        path: i,
        state: n?.state,
        replace: n?.replace
      });
    },
    redirect(i) {
      const n = Te({ url: i });
      if (!n.valid) {
        p(T.REDIRECT, n.errors);
        return;
      }
      c(T.REDIRECT, { url: i });
    },
    navTo(i, n) {
      if (i.startsWith("http://") || i.startsWith("https://")) {
        this.redirect(i);
        return;
      }
      this.navigate(i, n);
    },
    setTitle(i) {
      if (typeof i != "string" || !i.trim()) {
        p(T.SET_TITLE, [
          "Title must be a non-empty string"
        ]);
        return;
      }
      c(T.SET_TITLE, { title: i });
    },
    resize: t,
    autoResize: e,
    stopAutoResize: r
  };
}
function De() {
  const t = A(), e = A(), r = [];
  return r.push(
    b(h.ACTION_CLICK, (i) => {
      t.notify(i.payload.value);
    })
  ), r.push(
    b(h.ADD_ITEM_RESPONSE, (i) => {
      if (!i.requestId) return;
      const n = i.payload;
      if (typeof n.error == "string" && n.error.trim()) {
        const a = n.error.trim();
        o.warn(`embedded::nav.addItem failed: ${a}`), C(
          i.requestId,
          {},
          a
        );
        return;
      }
      const s = n.item;
      if (s && typeof s.value == "string" && s.value.trim()) {
        const a = s.value.trim(), l = {
          value: a,
          id: a
        };
        C(i.requestId, l);
      }
    })
  ), r.push(
    b(h.ITEM_CLICK, (i) => {
      const n = i.payload, s = typeof n.value == "string" && n.value.trim() ? n.value.trim() : typeof n.id == "string" && n.id.trim() ? n.id.trim() : "";
      if (!s) {
        e.notify(n);
        return;
      }
      e.notify({
        ...n,
        value: s,
        id: s
      });
    })
  ), {
    setAction(i) {
      const n = Ie(i);
      if (!n.valid) {
        p(h.SET_ACTION, n.errors);
        return;
      }
      c(h.SET_ACTION, {
        title: i.title,
        value: i.value,
        subTitle: i.subTitle,
        icon: i.icon,
        disabled: i.disabled,
        extendedActions: i.extendedActions?.map((s) => ({
          title: s.title,
          value: s.value,
          subTitle: s.subTitle,
          icon: s.icon,
          disabled: s.disabled
        }))
      });
    },
    clearAction() {
      c(h.CLEAR_ACTION, {});
    },
    onActionClick(i) {
      return t.subscribe(i);
    },
    addNavItem(i) {
      const n = Ae(i);
      return n.valid ? x(h.ADD_ITEM, { item: i }, 2e3) : (p(h.ADD_ITEM, n.errors), Promise.reject(new Error(n.errors[0])));
    },
    updateNavItem(i) {
      const n = Re(i);
      if (!n.valid) {
        p(h.UPDATE_ITEM, n.errors);
        return;
      }
      const s = i, a = typeof s.value == "string" ? s.value.trim() : "", l = typeof s.id == "string" ? s.id.trim() : "", f = a || l, { id: d, ...m } = s;
      c(h.UPDATE_ITEM, {
        item: { ...m, value: f }
      });
    },
    removeNavItem(i) {
      const n = Ne(i);
      if (!n.valid) {
        p(h.REMOVE_ITEM, n.errors);
        return;
      }
      c(h.REMOVE_ITEM, { value: i });
    },
    onNavItemClick(i) {
      return e.subscribe(i);
    },
    destroy() {
      r.forEach((i) => i()), r.length = 0, t.clear(), e.clear();
    }
  };
}
function Me() {
  return {
    /**
     * Show loading indicator.
     */
    show() {
      c(g.LOADING, { action: "show" });
    },
    /**
     * Hide loading indicator.
     */
    hide() {
      c(g.LOADING, { action: "hide" });
    }
  };
}
function Oe() {
  return {
    hide() {
      c(g.BREADCRUMBS, { action: "hide" });
    },
    show() {
      c(g.BREADCRUMBS, { action: "show" });
    }
  };
}
function Le() {
  const t = (e) => {
    const r = be(e);
    if (!r.valid) {
      p(g.TOAST, r.errors);
      return;
    }
    c(g.TOAST, {
      type: e.type,
      message: e.message,
      duration: e.duration
    });
  };
  return {
    /**
     * Show a toast notification.
     */
    show: t,
    /**
     * Show success toast.
     */
    success(e, r) {
      t({ type: "success", message: e, duration: r });
    },
    /**
     * Show error toast.
     */
    error(e, r) {
      t({ type: "error", message: e, duration: r });
    },
    /**
     * Show warning toast.
     */
    warning(e, r) {
      t({ type: "warning", message: e, duration: r });
    },
    /**
     * Show info toast.
     */
    info(e, r) {
      t({ type: "info", message: e, duration: r });
    }
  };
}
function qe() {
  return async (t) => {
    const e = $e(t);
    return e.valid ? x(g.CONFIRM, {
      title: t.title,
      message: t.message,
      confirmText: t.confirmText ?? "Confirm",
      cancelText: t.cancelText ?? "Cancel",
      variant: t.variant ?? "info"
    }) : (p(g.CONFIRM, e.errors), Promise.reject(new Error(e.errors.join(", "))));
  };
}
function ke() {
  return {
    loading: Me(),
    breadcrumbs: Oe(),
    toast: Le(),
    confirm: qe()
  };
}
function xe() {
  const t = A(), e = [];
  return e.push(
    b(y.RESPONSE, (r) => {
      t.notify({
        success: r.payload.success,
        order_id: r.payload.order_id,
        status: r.payload.status,
        error: r.payload.error,
        context: r.payload.context
      });
    })
  ), e.push(
    b(
      y.GET_ADDONS_RESPONSE,
      (r) => {
        r.requestId && C(r.requestId, {
          success: r.payload.success,
          addons: r.payload.addons,
          error: r.payload.error
        });
      }
    )
  ), {
    create(r, i) {
      const n = Array.isArray(r) ? r : [r], s = ye({ items: n });
      if (!s.valid)
        throw p(y.CREATE, s.errors), new Error(s.errors[0]);
      c(
        y.CREATE,
        {
          items: n.map((a) => ({
            type: a.type,
            slug: a.slug,
            quantity: a.quantity ?? 1
          })),
          ...i?.context !== void 0 && { context: i.context }
        },
        "*",
        Y()
      );
    },
    onResult(r) {
      return t.subscribe(r);
    },
    async getAddons() {
      try {
        return await x(
          y.GET_ADDONS,
          {},
          3e4
        );
      } catch (r) {
        return {
          success: !1,
          error: {
            code: "REQUEST_FAILED",
            message: r instanceof Error ? r.message : "Unknown error"
          }
        };
      }
    },
    resetCache() {
      c(y.RESET_CACHE, {}, "*");
    },
    destroy() {
      e.forEach((r) => r()), e.length = 0, t.clear();
    }
  };
}
const G = {
  theme: "light",
  dir: "rtl",
  width: 0,
  locale: "ar",
  currency: "SAR"
};
class ze {
  constructor() {
    this.initialized = !1, this.initializing = !1, this.debugMode = !1, this.appReady = !1, this.layout = { ...G }, this.postInitHooks = [], this.themeSubscription = A(), this.initSubscription = A(), this.auth = ve(), this.page = _e(), this.nav = De(), this.ui = ke(), this.checkout = xe(), this.registerPostInitHook((e) => {
      const r = e.payload.pendingCheckoutResult;
      r && (o.debug("Dispatching pending checkout result:", r), queueMicrotask(() => {
        le(y.RESPONSE, {
          success: r.success,
          status: r.status,
          error: r.error,
          context: r.context
        });
      }));
    }), this.setupListeners();
  }
  /**
   * Register a hook to run after successful init handshake.
   * Used by modules to process context data.
   */
  registerPostInitHook(e) {
    this.postInitHooks.push(e);
  }
  /**
   * Set up core event listeners.
   */
  setupListeners() {
    b(U.THEME_CHANGE, (e) => {
      this.layout.theme = e.payload.theme, o.debug("Theme changed:", e.payload.theme), this.themeSubscription.notify(e.payload.theme);
    }), b(g.CONFIRM_RESPONSE, (e) => {
      o.debug("Received confirm response:", e), e.requestId && C(e.requestId, { confirmed: e.payload.confirmed });
    });
  }
  /**
   * Get current SDK state.
   */
  getState() {
    return {
      ready: this.initialized,
      initializing: this.initializing,
      layout: { ...this.layout }
    };
  }
  /**
   * Check if SDK is initialized and ready.
   */
  isReady() {
    return this.initialized;
  }
  /**
   * Subscribe to theme changes.
   */
  onThemeChange(e) {
    return this.themeSubscription.subscribe(e);
  }
  /**
   * Subscribe to init completion. Fires immediately if already initialized.
   */
  onInit(e) {
    if (this.initialized)
      try {
        e(this.getState());
      } catch (r) {
        o.error("Error in init callback:", r);
      }
    return this.initSubscription.subscribe(e);
  }
  /**
   * Signal that the app is fully loaded and ready.
   */
  ready() {
    if (this.appReady) {
      o.debug("App already signaled as ready");
      return;
    }
    if (!this.initialized) {
      o.warn("Cannot signal ready before init() is called");
      return;
    }
    this.appReady = !0, c(q.READY, {}), o.debug("Sent ready signal to host");
  }
  /**
   * Initialize the SDK and establish connection with the host.
   */
  async init(e = {}) {
    if (this.initialized)
      return o.debug("Already initialized, returning current layout"), { layout: { ...this.layout } };
    if (this.initializing)
      return o.warn("Initialization already in progress"), new Promise((r) => {
        const i = this.onInit((n) => {
          i(), r({ layout: { ...n.layout } });
        });
      });
    this.initializing = !0, this.debugMode = e.debug ?? !1, ne({ debug: this.debugMode }), ce() || o.warn("Not running in an iframe. Some features may not work."), o.debug("Initializing SDK...");
    try {
      c(q.INIT, {
        height: document.documentElement.scrollHeight
      }), o.debug("Sent iframe.ready message, waiting for context...");
      const r = await ue(
        U.PROVIDE
      );
      o.debug("Received context from host:", r);
      const { layout: i } = r.payload;
      return this.layout = {
        theme: i?.theme ?? "light",
        dir: i?.dir ?? ie(i?.locale),
        width: i?.width ?? 0,
        locale: i?.locale ?? "ar",
        currency: i?.currency ?? "SAR"
      }, this.postInitHooks.forEach((n) => {
        try {
          n(r);
        } catch (s) {
          o.error("Error in post-init hook:", s);
        }
      }), this.initialized = !0, this.initializing = !1, o.debug("Initialization complete. Layout:", this.layout), this.initSubscription.notify(this.getState()), { layout: { ...this.layout } };
    } catch (r) {
      throw this.initializing = !1, r;
    }
  }
  /**
   * Destroy the SDK instance and clean up resources.
   */
  destroy() {
    o.debug("Destroying SDK instance"), this.initialized && (c(q.DESTROY, {}), o.debug("Sent destroy event to host")), this.checkout.destroy(), this.nav.destroy(), he("SDK destroyed"), de(), this.themeSubscription.clear(), this.initSubscription.clear(), this.postInitHooks = [], this.initialized = !1, this.initializing = !1, this.appReady = !1, this.layout = { ...G };
  }
}
let I = null;
function J() {
  return I || (I = new ze()), I;
}
function Ve() {
  I && (I.destroy(), I = null);
}
const B = J(), Ue = D;
typeof window < "u" && (window.salla = window.salla || window.Salla || {}, window.Salla = window.salla, window.salla.embedded || (window.salla.embedded = B), window.Salla.embedded || (window.Salla.embedded = B));
export {
  ze as EmbeddedApp,
  B as embedded,
  J as getEmbeddedApp,
  Ve as resetEmbeddedApp,
  Ue as version
};
//# sourceMappingURL=index.js.map
