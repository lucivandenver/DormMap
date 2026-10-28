
      /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    
import "dotenv/config";
import { Sequelize } from "sequelize";
import { databaseConfig } from '../config/database.js';

const { database, username, password, host, port, ssl } = databaseConfig();

export const sequelize = new Sequelize(database, username, password, {
  host,
  port,
  dialect: 'mysql',
  dialectOptions: { connectTimeout: 10000, ...(ssl ? { ssl } : {}) },
  pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
  // Set DB_LOGGING=true only when debugging SQL. Keeping this off prevents
  // normal page requests from flooding the terminal with SELECT statements.
  logging: process.env.DB_LOGGING === "true" ? console.log : false,
});
