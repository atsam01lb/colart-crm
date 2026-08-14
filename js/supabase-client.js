// Colart CRM — Supabase connection
const SUPABASE_URL = "https://etsxxotnviwuibcqflma.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_iwxM8x8zVX5tQB1ZrhMtVw_dTqPNNMl";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
