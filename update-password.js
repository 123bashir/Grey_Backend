import 'dotenv/config';
import mysql from 'mysql2/promise';

async function updatePassword() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASS || '',
            database: process.env.DB_NAME || 'grayinsaat'
        });

        console.log('Connected to database');

        // Update the password
        const [result] = await connection.execute(
            'UPDATE staff SET password = ? WHERE email = ?',
            ['Candd4611@', 'ktoranke@gmail.com']
        );

        console.log(`✅ Password updated. Rows affected: ${result.affectedRows}`);

        // Verify the update
        const [rows] = await connection.execute(
            'SELECT id, email, name, role, password FROM staff WHERE email = ?',
            ['ktoranke@gmail.com']
        );

        if (rows.length > 0) {
            console.log('\n📋 User details:');
            console.log(rows[0]);
        } else {
            console.log('⚠️  No user found with that email');
        }

        await connection.end();
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

updatePassword();
