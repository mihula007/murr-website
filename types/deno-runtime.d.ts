// Минимальные типы Deno для точек входа Edge Functions: общий код в
// supabase/functions/_shared не использует глобалы Deno и проверяется tsc.
declare namespace Deno {
  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void
  const env: { get(name: string): string | undefined }
}
