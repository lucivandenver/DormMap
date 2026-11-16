import test from 'node:test';
import assert from 'node:assert/strict';
import { sequelize } from '../models/db.js';
import { User } from '../models/userModel.js';
import { TenantApplication } from '../models/tenantModels.js';
import { serveReviewFile, storeReviewFile } from '../services/reviewFileService.js';

test('tenant registration files are served only to the uploader or an authorized reviewer', async t => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff]);
  const model = sequelize.models.ReviewFile;
  let record;
  t.mock.method(model, 'create', async values => { record = values; });
  t.mock.method(model, 'findByPk', async () => record);
  t.mock.method(User, 'findByPk', async id => ({
    id, accountType: id === 5 ? 'tenant' : 'boarding_house_owner', applicationStatus: 'approved'
  }));
  t.mock.method(TenantApplication, 'findOne', async ({ where }) => (
    where.tenantId === 5 && where.ownerId === 8 ? { id: 10 } : null
  ));

  const url = await storeReviewFile({ originalname: 'tenant ID.jpg', buffer: bytes }, 5, 'tenant-registration');
  const [, , id, filename] = url.split('/');
  assert.match(url, /^\/documents\/[0-9a-f-]+\/tenant_ID\.jpg$/);

  for (const userId of [undefined, 9, 8, 5]) {
    const res = {
      set(headers) { this.headers = headers; },
      sendStatus(status) { this.status = status; },
      type(value) { this.contentType = value; },
      send(buffer) { this.buffer = buffer; }
    };
    await serveReviewFile({ params: { id, filename }, session: { userId } }, res, assert.ifError);
    if (userId === 5 || userId === 8) {
      assert.equal(res.headers['Cache-Control'], 'private, no-store');
      assert.equal(res.contentType, 'image/jpeg');
      assert.deepEqual(res.buffer, bytes);
    } else {
      assert.equal(res.status, 404);
      assert.equal(res.buffer, undefined);
    }
  }
});
