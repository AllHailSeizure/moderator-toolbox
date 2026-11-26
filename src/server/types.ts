import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnPostSubmitRequest,
  OnPostFlairUpdateRequest,
  OnCommentCreateRequest,
  OnPostReportRequest,
  OnCommentReportRequest,
  OnModActionRequest,
  OnPostDeleteRequest,
  OnModMailRequest,
} from '@devvit/web/shared';

export type ModuleHandler<T> = (event: T) => Promise<void>;

export type AppInstallHandler      = ModuleHandler<OnAppInstallRequest>;
export type AppUpgradeHandler      = ModuleHandler<OnAppUpgradeRequest>;
export type PostSubmitHandler      = ModuleHandler<OnPostSubmitRequest>;
export type PostFlairUpdateHandler = ModuleHandler<OnPostFlairUpdateRequest>;
export type CommentCreateHandler   = ModuleHandler<OnCommentCreateRequest>;
export type PostReportHandler    = ModuleHandler<OnPostReportRequest>;
export type CommentReportHandler = ModuleHandler<OnCommentReportRequest>;
export type ModActionsHandler    = ModuleHandler<OnModActionRequest>;
export type PostDeleteHandler    = ModuleHandler<OnPostDeleteRequest>;
export type ModMailHandler       = ModuleHandler<OnModMailRequest>;

// ─── Reddit ID branded types ───────────────────────────────────────────────────

export type CommentId = `t1_${string}`;
export type PostId    = `t3_${string}`;

