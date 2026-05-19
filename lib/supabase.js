import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://eqfyqwjvrislzgsazilk.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxZnlxd2p2cmlzbHpnc2F6aWxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNDc0MDcsImV4cCI6MjA5MzYyMzQwN30.bkv7JkIjwCo_dTLqu-m3KaP0Cpc_WMsTcLdVyhGujwo";

console.log("Supabase URL:", supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey)