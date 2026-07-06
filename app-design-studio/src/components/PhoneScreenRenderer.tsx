import {
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEventHandler,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from "react";
import DOMPurify from "dompurify";

type Platform = "ios" | "android";

// Scoping/rendering conventions live in the IR module (shared with the
// resolve pass and the visual test harness) — re-exported here for existing
// consumers (FlowCanvas, workspace).
export { PHONE_SCREEN_PAGE_CLASS, scopedPhoneScreenCss } from "@/lib/ir";
import { PHONE_SCREEN_PAGE_CLASS, scopedPhoneScreenCss } from "@/lib/ir";

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
  /** Fixed frame height — set for Figma imports (fixed-size design frames).
   *  When set, the renderer switches to plain-canvas mode (no phone chrome)
   *  and uses this exact height instead of the phone height or website auto. */
  frameHeight?: number | null;
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
  frameHeight = null,
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

  // Plain-canvas mode: website (scrolling, auto height) OR figma (fixed-size
  // design frame with an explicit height). Both drop the phone chrome/bezel
  // and use the provided frameWidth instead of the phone width.
  const plain = isWebsite || frameHeight != null;
  const resolvedWidth = plain && frameWidth ? frameWidth : PHONE_FRAME.width;
  // Height: figma → its real frame height; website → auto (scrolls); app → phone height.
  const resolvedHeight =
    frameHeight != null ? frameHeight : isWebsite ? "auto" : PHONE_FRAME.height;

  // Scoping the design-system CSS runs a regex over the entire stylesheet,
  // which for cloned websites can be ~500KB. PhoneScreenRenderer re-renders on
  // every canvas interaction (selection, hover, zoom, pan), so recomputing this
  // inline was the dominant source of Pro-mode editing lag. Memoize on `css`
  // alone so it only recomputes when the stylesheet actually changes.
  const scopedCss = useMemo(() => (css ? scopedPhoneScreenCss(css) : ""), [css]);

  return (
    <div
      ref={(node) => assignRef(rootRef, node)}
      className={`relative ${className}`}
      style={{
        width: resolvedWidth,
        height: resolvedHeight,
        ...rootStyle,
      }}
      onClickCapture={onClickCapture}
    >
      {!plain && <PhoneFrameOutline platform={platform} />}
      {!plain && <PhoneNotch platform={platform} />}
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
          borderRadius: plain ? 0 : PHONE_FRAME.contentRadius,
          fontSize: "16px",
          width: resolvedWidth,
          height: resolvedHeight,
          ...pageStyle,
        }}
        data-testid="canvas-page"
        data-phone-screen-page
      />
      {scopedCss && (
        <style
          data-phone-screen-css
          // Not part of the editable HTML — sibling of the page container,
          // so Pro commits only the screen document, not the renderer CSS.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: scopedCss }}
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
