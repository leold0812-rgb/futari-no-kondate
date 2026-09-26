/**
 * 環境変数の不足・不正を表すエラー。
 * messageには変数名と回復方法だけを含め、値そのものは絶対に含めない。
 */
export class EnvConfigError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[], reason: string) {
    super(
      `環境変数の設定に問題があります（${variables.join(", ")}）：${reason}。` +
        "`.env.example` を参考に `.env.local`（本番はVercelの環境変数）を設定し、サーバーを再起動してください。",
    );
    this.name = "EnvConfigError";
    this.variables = variables;
  }
}
