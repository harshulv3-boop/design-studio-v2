import { useLayoutEffect, useRef, type CSSProperties, type MouseEventHandler, type MutableRefObject, type ReactNode, type Ref } from "react";
import DOMPurify from "dompurify";

type Platform = "ios" | "android";

export const PHONE_SCREEN_PAGE_CLASS = "phone-screen-page";

export const PHONE_FRAME = {
  width: 375,
  height: 812,
  borderWidth: 6,
  iosOuterRadius: 52,
  androidOuterRadius: 42,
  contentRadius: 46,
  notch: {
    top: 8,
    width: 100,
    height: 26,
  },
} as const;

function radiusFor(platform: Platform) {
  return platform === "ios" ? PHONE_FRAME.iosOuterRadius : PHONE_FRAME.androidOuterRadius;
}

function PhoneNotch({ platform }: { platform: Platform }) {
  if (platform !== "ios") return null;

  return (
    <div
      aria-hidden
      data-phone-notch
      data-overlay
      style={{
        position: "absolute",
        top: PHONE_FRAME.notch.top,
        left: "50%",
        width: PHONE_FRAME.notch.width,
        height: PHONE_FRAME.notch.height,
        transform: "translateX(-50%)",
        borderRadius: 999,
        background: "var(--phone-shell)",
        pointerEvents: "none",
        zIndex: 30,
      }}
    />
  );
}

function PhoneFrameOutline({ platform }: { platform: Platform }) {
  return (
    <div
      aria-hidden
      data-phone-outline
      data-overlay
      style={{
        position: "absolute",
        inset: -PHONE_FRAME.borderWidth,
        borderRadius: radiusFor(platform),
        border: `${PHONE_FRAME.borderWidth}px solid var(--phone-frame-border)`,
        background: "var(--phone-shell)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}

export function sanitizePhoneScreenHtml(html: string): string {
  return DOMPurify.sanitize(html || "", {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base", "form"],
    FORBID_ATTR: ["srcdoc", "formaction", "ping"],
    ALLOW_DATA_ATTR: true,
    ADD_TAGS: ["style"],
    FORCE_BODY: true,
  });
}

function adaptCssForScopedPhoneScreen(css: string): string {
  return (css || "").replace(/(^|[\s,{}])(:root)\b/g, "$1:scope, .screen");
}

export function scopedPhoneScreenCss(css: string): string {
  const normalized = `
:scope {
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  font-size: 16px;
  /* Pin text-align so the screen never inherits it from the wrapper element.
     Lite renders inside a <button> (UA default text-align: center) while Pro
     renders inside a <div> (text-align: start); without this, identical
     screens diverge — centered in Lite, left in Pro. Design-system CSS and
     per-element styles can still override this. */
  text-align: left;
  /* Establish a containing block so position:fixed / width:100vw descendants
     (e.g. a bottom tab bar) are sized and clipped to the phone frame instead
     of escaping to the browser viewport. */
  transform: translateZ(0);
  contain: layout paint;
  color: var(--text, inherit);
  background: var(--bg, #000);
}
:scope, :scope * { box-sizing: border-box; }
`;

  return `@scope (.${PHONE_SCREEN_PAGE_CLASS}) to (.phone-screen-page-boundary) {\n${normalized}\n${adaptCssForScopedPhoneScreen(css)}\n}`;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

type PhoneScreenRendererProps = {
  platform: Platform;
  html: string;
  css: string;
  htmlVersion?: number;
  isWebsite?: boolean;
  frameWidth?: number | null;
  pageRef?: Ref<HTMLDivElement>;
  rootRef?: Ref<HTMLDivElement>;
  className?: string;
  pageClassName?: string;
  pageStyle?: CSSProperties;
  rootStyle?: CSSProperties;
  onClickCapture?: MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
  afterHtmlRender?: (page: HTMLDivElement) => void;
  children?: ReactNode;
};

/**
 * The one canonical phone-screen renderer used by both Lite and Pro.
 * It owns the fixed phone dimensions, chrome/notch, CSS scoping, and HTML
 * placement. Lite passes read-only HTML; Pro passes the same HTML and layers
 * editing overlays/interactions around this same rendered page.
 */
export function PhoneScreenRenderer({
  platform,
  html,
  css,
  htmlVersion,
  isWebsite = false,
  frameWidth = null,
  pageRef,
  rootRef,
  className = "",
  pageClassName = "",
  pageStyle,
  rootStyle,
  onClickCapture,
  onDoubleClick,
  afterHtmlRender,
  children,
}: PhoneScreenRendererProps) {
  const localPageRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const page = localPageRef.current;
    if (!page) return;
    const safeHtml = sanitizePhoneScreenHtml(html);
    if (page.innerHTML !== safeHtml) {
      page.innerHTML = safeHtml;
    }
    afterHtmlRender?.(page);
    // htmlVersion intentionally lets Pro force a re-render even if html string
    // returns to a previous value via undo/redo.
  }, [html, htmlVersion, afterHtmlRender]);

  const resolvedWidth = isWebsite && frameWidth ? frameWidth : PHONE_FRAME.width;

  return (
    <div
      ref={(node) => assignRef(rootRef, node)}
      className={`relative ${className}`}
      style={{
        width: resolvedWidth,
        height: isWebsite ? "auto" : PHONE_FRAME.height,
        ...rootStyle,
      }}
      onClickCapture={onClickCapture}
    >
      {!isWebsite && <PhoneFrameOutline platform={platform} />}
      {!isWebsite && <PhoneNotch platform={platform} />}
      <div
        ref={(node) => {
          localPageRef.current = node;
          assignRef(pageRef, node);
        }}
        onDoubleClick={onDoubleClick}
        className={`${PHONE_SCREEN_PAGE_CLASS} shadow-2xl ${pageClassName}`}
        style={{
          position: "relative",
          zIndex: 1,
          display: "block",
          overflow: "hidden",
          background: "#000",
          borderRadius: isWebsite ? 0 : PHONE_FRAME.contentRadius,
          fontSize: "16px",
          width: resolvedWidth,
          height: isWebsite ? "auto" : PHONE_FRAME.height,
          ...pageStyle,
        }}
        data-testid="canvas-page"
        data-phone-screen-page
      />
      {css && (
        <style
          data-phone-screen-css
          // Not part of the editable HTML — sibling of the page container,
          // so Pro commits only the screen document, not the renderer CSS.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: scopedPhoneScreenCss(css) }}
        />
      )}
      {/* Interactive overlay layer (Pro selection boxes / drag+resize handles /
          guides). MUST paint above the page content (which has zIndex:1) or
          pointer-downs land on the rendered HTML instead of the handles and
          drag/resize never start. The layer itself is click-through
          (pointer-events:none); individual handles opt back in with
          pointer-events:auto. */}
      {children != null && children !== false && (
        <div
          data-overlay-layer
          style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}