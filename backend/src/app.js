import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { authRoutes } from './routes/auth.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { barangayRoutes } from './routes/barangay.routes.js';
import { boardingHouseRoutes } from './routes/boardingHouse.routes.js';
import { permitRoutes } from './routes/permit.routes.js';
import { tenantRoutes } from './routes/tenant.routes.js';
import { messageRoutes } from './routes/message.routes.js';
import { reportRoutes } from './routes/report.routes.js';
import { mapRoutes } from './routes/map.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { Role, syncModels } from './models/index.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => console.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`));
    next();
  });
}
app.use('/uploads', express.static(new URL('../public/uploads', import.meta.url).pathname));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/barangays', barangayRoutes);
app.use('/api/boarding-houses', boardingHouseRoutes);
app.use('/api/permits', permitRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/maps', mapRoutes);
app.use('/api/audit-logs', auditRoutes);

app.get('/api/ping', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use(errorHandler);

await syncModels();
await Promise.all([
  { name: 'super_admin', label: 'Super Admin', description: 'Full access to all features.' },
  { name: 'barangay_official', label: 'Barangay Official', description: 'Manage barangay resources and permit approvals.' },
  { name: 'owner', label: 'Boarding House Owner', description: 'Manage boarding houses and tenants.' },
  { name: 'tenant', label: 'Tenant', description: 'Tenant access for room and profile management.' },
].map((role) => Role.findOrCreate({ where: { name: role.name }, defaults: role })));

export default app;
