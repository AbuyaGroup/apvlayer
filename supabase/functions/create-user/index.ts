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
            return jsonResponse({ error: 'Cuma Master Layer yang boleh bikin akun.' }, 403)
        }

        const { username, password, role, brand } = await req.json()
        if (!username || !password || !role) {
            return jsonResponse({ error: 'Username, password, dan role wajib diisi.' }, 400)
        }
        if (String(password).length < 6) {
            return jsonResponse({ error: 'Password minimal 6 karakter.' }, 400)
        }

        const email = String(username).includes('@') ? String(username) : `${username}@abuyagroup.com`
        const finalBrand = role === 'Master' ? null : (brand || null)

        const { data: existingRole } = await adminClient
            .from('user_roles')
            .select('email')
            .ilike('email', email)
            .maybeSingle()

        if (existingRole) {
            return jsonResponse({ error: `Username "${username}" udah dipake, gak boleh nimpa akun yang udah ada.` }, 400)
        }

        const { error: createError } = await adminClient.auth.admin.createUser({
            email,
            password: String(password),
            email_confirm: true
        })
        if (createError) {
            return jsonResponse({ error: createError.message }, 400)
        }

        const { error: roleError } = await adminClient
            .from('user_roles')
            .insert({ email, role, brand: finalBrand })

        if (roleError) {
            return jsonResponse({ error: 'Akun dibuat tapi gagal set role: ' + roleError.message }, 400)
        }

        return jsonResponse({ success: true, email }, 200)
    } catch (err) {
        return jsonResponse({ error: err.message || 'Internal error' }, 500)
    }
})
