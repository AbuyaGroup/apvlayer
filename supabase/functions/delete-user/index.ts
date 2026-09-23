import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonResponse = (body, status) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return jsonResponse({ error: 'Missing Authorization header' }, 401)
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        const adminClient = createClient(supabaseUrl, serviceRoleKey)

        const token = authHeader.replace('Bearer ', '')
        const { data: { user: callerUser }, error: callerError } = await adminClient.auth.getUser(token)
        if (callerError || !callerUser?.email) {
            return jsonResponse({ error: 'Token gak valid.' }, 401)
        }

        const { data: callerRole } = await adminClient
            .from('user_roles')
            .select('role')
            .ilike('email', callerUser.email)
            .maybeSingle()

        if (!callerRole || callerRole.role !== 'Master') {
            return jsonResponse({ error: 'Cuma Master Layer yang boleh hapus akun.' }, 403)
        }

        const { ids } = await req.json()
        if (!Array.isArray(ids) || ids.length === 0) {
            return jsonResponse({ error: 'Gak ada akun yang dipilih.' }, 400)
        }

        const { data: targetRows, error: targetError } = await adminClient
            .from('user_roles')
            .select('id, email')
            .in('id', ids)

        if (targetError) {
            return jsonResponse({ error: targetError.message }, 400)
        }

        const filteredTargets = (targetRows || []).filter(
            (row) => row.email.toLowerCase() !== callerUser.email.toLowerCase()
        )

        if (filteredTargets.length === 0) {
            return jsonResponse({ error: 'Gak ada akun valid buat dihapus (gak bisa hapus akun sendiri).' }, 400)
        }

        const { data: authList, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
        if (listError) {
            return jsonResponse({ error: 'Gagal ambil daftar akun Auth: ' + listError.message }, 400)
        }

        const deleted = []
        const failed = []

        for (const target of filteredTargets) {
            const authUser = (authList?.users || []).find(
                (u) => (u.email || '').toLowerCase() === target.email.toLowerCase()
            )

            if (authUser) {
                const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(authUser.id)
                if (deleteAuthError) {
                    failed.push({ email: target.email, error: deleteAuthError.message })
                    continue
                }
            }

            const { error: deleteRoleError } = await adminClient
                .from('user_roles')
                .delete()
                .eq('id', target.id)

            if (deleteRoleError) {
                failed.push({ email: target.email, error: deleteRoleError.message })
                continue
            }

            deleted.push(target.email)
        }

        return jsonResponse({ success: true, deleted, failed }, 200)
    } catch (err) {
        return jsonResponse({ error: err.message || 'Internal error' }, 500)
    }
})
