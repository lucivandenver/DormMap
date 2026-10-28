import 'dotenv/config';
import inquirer from 'inquirer';
import bcrypt from 'bcrypt';
import { User } from '../models/userModel.js';
import { sequelize } from '../models/db.js';

try {
  const answers = await inquirer.prompt([
    { name: 'fullName', message: 'Admin full name:', validate: value => value.trim().length > 1 || 'Enter a name.' },
    { name: 'email', message: 'Admin email:', validate: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Enter a valid email.' },
    { type: 'password', name: 'password', message: 'Password (at least 12 characters):', mask: '*', validate: value => value.length >= 12 || 'Use at least 12 characters.' },
  ]);
  const email = answers.email.trim().toLowerCase();
  const exists = await User.findOne({ where: { email } });
  if (exists) throw new Error('That email already exists. No account was changed.');
  await User.create({ fullName: answers.fullName.trim(), email, password: await bcrypt.hash(answers.password, 12), accountType: 'super_admin', emailVerified: true });
  console.log('Admin created. Sign in with the email and password you entered.');
} catch (error) {
  console.error('Admin creation failed:', error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
