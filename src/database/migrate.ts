import { runMigrations, isPostgresConnected } from './db-client';

async function main() {
  console.log('----------------------------------------------------');
  console.log('🚀 MedFinder Ethiopia: Running Database Migrations');
  console.log('----------------------------------------------------');

  if (!process.env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL environment variable is missing.');
    console.log('💡 Tip: Add your Supabase connection string to .env:');
    console.log('   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres');
    process.exit(1);
  }

  const connected = await isPostgresConnected();
  if (!connected) {
    console.error('❌ Could not connect to PostgreSQL database. Please verify credentials in DATABASE_URL.');
    process.exit(1);
  }

  console.log('Connected to PostgreSQL successfully.');
  const result = await runMigrations();
  if (!result.success) {
    console.error('Migration failed:', result.message);
    process.exit(1);
  }

  console.log('🎉 Done! Database is ready for MedFinder Ethiopia.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
