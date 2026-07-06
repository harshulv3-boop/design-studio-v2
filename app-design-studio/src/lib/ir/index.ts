/**
 * The ONLY public entry to the IR module (lint-enforced). Every function here
 * takes/returns Project or plain files — IRDocument never crosses this
 * boundary, which is what guarantees the IR can never become a second live
 * copy of canvas state.
 */

export { buildHtmlExport } from "./formats/html/export";
export {
  isSleekHtmlExport,
  parseSleekHtmlExport,
  projectFromSleekHtmlExport,
} from "./formats/html/import";
export { buildReactTsx, buildReactProjectExport } from "./formats/react/export";
export { buildVueProjectExport } from "./formats/vue/export";
export { buildAngularProjectExport } from "./formats/angular/export";
export { angularTemplateToStaticHtml } from "./formats/angular/import";
export { buildFigmaExport, type FigmaExportOptions } from "./formats/figma/export-nodes";
export {
  figmaNodeToIrChildren,
  figmaResponseToScreens,
  type FigmaImportOptions,
} from "./formats/figma/import";
export {
  parseFigmaUrl,
  type FigmaImagesResponse,
  type FigmaNode,
  type FigmaNodesResponse,
} from "./formats/figma/api-types";
export type {
  FigmaExportDocument,
  FigmaNodeSpec,
  FrameNodeSpec,
  TextNodeSpec,
  RectangleNodeSpec,
  EllipseNodeSpec,
  SvgNodeSpec,
} from "./formats/figma/types";
export { assembleImportedProject } from "./core/assemble";
export {
  PHONE_SCREEN_PAGE_CLASS,
  scopedPhoneScreenCss,
  adaptCssForScopedPhoneScreen,
  buildScreenDocument,
} from "./resolve/render-doc";
