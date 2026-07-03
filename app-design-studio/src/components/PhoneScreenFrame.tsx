import type { CSSProperties, KeyboardEvent, MouseEventHandler, ReactNode, Ref } from "react";
import { PhoneScreenRenderer } from "@/components/PhoneScreenRenderer";

type Platform = "ios" | "android";

type PhoneScreenFrameProps = {
  // ---- forwarded verbatim to the one shared renderer ----
  platform: Platform;
  html: string;
  css: string;
  htmlVersion?: number;
  isWebsite?: boolean;
  frameWidth?: number | null;
  pageRef?: Ref<HTMLDivElement>;
  pageClassName?: string;
  onClickCapture?: MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;

  // ---- the single wrapper element both modes place the renderer in ----
  wrapperClassName?: string;
  wrapperStyle?: CSSProperties;
  wrapperData?: Record<string, string>;
  /** Lite passes this to make the frame click/keyboard selectable. */
  onSelect?: () => void;
  /** Pro passes the interactive overlay (selection boxes / handles / guides). */
  children?: ReactNode;
};

/**
 * The ONE wrapper both Lite and Pro place `PhoneScreenRenderer` in.
 *
 * Keeping this element identical across modes is the architectural guarantee
 * that a screen can never inherit a divergent layout context from mode-specific
 * markup (this is what caused the Lite-vs-Pro text-align split: Lite used a
 * <button> whose UA default text-align:center inherited into the screen, Pro a
 * <div> that did not). Interactivity is purely additive:
 *   • Lite  → passes `onSelect` (click/keyboard to select), no overlay.
 *   • Pro   → passes an overlay via `children` and a transform via `wrapperStyle`.
 * Nothing about the rendered screen differs between the two.
 */
export function PhoneScreenFrame({
  platform,
  html,
  css,
  htmlVersion,
  isWebsite,
  frameWidth,
  pageRef,
  pageClassName,
  onClickCapture,
  onDoubleClick,
  wrapperClassName = "",
  wrapperStyle,
  wrapperData,
  onSelect,
  children,
}: PhoneScreenFrameProps) {
  const selectable = typeof onSelect === "function";
  const selectableProps = selectable
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick: onSelect,
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect!();
          }
        },
      }
    : {};

  return (
    <div className={wrapperClassName} style={wrapperStyle} {...selectableProps} {...wrapperData}>
      <PhoneScreenRenderer
        platform={platform}
        html={html}
        css={css}
        htmlVersion={htmlVersion}
        isWebsite={isWebsite}
        frameWidth={frameWidth}
        pageRef={pageRef}
        pageClassName={pageClassName}
        onClickCapture={onClickCapture}
        onDoubleClick={onDoubleClick}
      >
        {children}
      </PhoneScreenRenderer>
    </div>
  );
}
