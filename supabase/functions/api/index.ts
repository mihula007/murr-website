// Точка входа прикладного API; маршруты добавляются вместе с сервисами.
Deno.serve(() => Response.json({ error: 'not_found' }, { status: 404 }))
