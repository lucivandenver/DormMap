const bplo = {
  label: 'BPLO Admin',
  path: '/admin',
  workflows: {
    overview: ['Dashboard Overview', 'Open Dashboard Overview for municipal totals, room inventory, permit status, and recent activity.'],
    registration_analytics: ['User Analytics', 'Open User Analytics. Filter by account type or registration period, or search by name, email, or barangay.'],
    gis_map: ['Municipal GIS Map', 'Open Municipal GIS Map to inspect property locations and municipal map data.'],
    data_requests: ['Data Requests Hub', 'Choose Create New Data Request, set the reporting period and deadline, then select all approved barangays or add specific targets before submitting.'],
    submissions: ['Barangay Submissions', 'Open Barangay Submissions to inspect reports sent by barangay officials and review their status.'],
    owners: ['Owner Applications', 'Open Owner Applications. Review the submitted documents, then choose an available review action for that owner.'],
    featured: ['Featured Listings', 'Open Featured Listings to manage which eligible boarding houses are featured publicly.'],
    renewals: ['Permit Renewals', 'Open Permit Renewals to inspect endorsed requests and use the available review action.'],
    barangays: ['Barangays', 'Open Barangays to review official accounts and manage their access.'],
    institutions: ['Nearby Places', 'Open Nearby Places to manage schools, landmarks, and other map entries.'],
    permits: ['Business Permits', 'Open Business Permits to review permit records and expiration dates.'],
    settings: ['System Settings', 'Open System Settings to manage BPLO configuration, including the landing page’s Dormigo questions.'],
    maintenance: ['System Maintenance', 'Open System Maintenance to access the maintenance settings and database export.'],
    announcements: ['Announcements', 'Open Announcements to compose a notice and select its intended audience before broadcasting.'],
    audit: ['Audit Logs', 'Open Audit Logs to review recorded administrative activity.']
  }
};

const barangay = {
  label: 'Barangay Official',
  path: '/barangay-dashboard',
  workflows: {
    overview: ['Dashboard Overview', 'Open Dashboard Overview for local property, room, and reporting summaries.'],
    data_requests: ['Data Requests & Submissions', 'Open Data Requests & Submissions to see requests addressed to your barangay, check deadlines, and submit the requested report.'],
    renewals: ['Permit Renewal Requests', 'Open Permit Renewal Requests to inspect local requests and endorse them to BPLO as appropriate.'],
    applications: ['Owner Applications', 'Open Owner Applications and select Inspect & Review to check the documents and choose an available barangay review action.'],
    houses: ['Boarding Houses', 'Open Boarding Houses to view local establishments and branch applications. Use the Actions dropdown for the establishment’s public map status.'],
    permits: ['Permit Monitoring', 'Open Permit Monitoring to check local permit records and expiration dates.'],
    tenants: ['Tenant Monitoring', 'Open Tenant Monitoring to view tenant records for establishments in your barangay.'],
    map: ['OpenStreetMap GIS', 'Open OpenStreetMap GIS to inspect boarding house locations within your barangay.'],
    announcements: ['Announcements', 'Open Announcements to view notices or post a barangay announcement.'],
    messages: ['Messaging', 'Open Messaging to view and reply to conversations in your barangay portal.'],
    reports: ['Reports & Masterlists', 'Open Reports & Masterlists to choose and generate a barangay report.'],
    notifications: ['Activity', 'Open Activity to review notifications for your barangay account.'],
    audit: ['Audit Logs', 'Open Audit Logs to review recorded actions in your barangay portal.'],
    profile: ['Official Profile', 'Open Official Profile to update your position title or contact number, then save your changes.']
  }
};

const owner = {
  label: 'Boarding House Owner',
  path: '/owner-dashboard',
  workflows: {
    overview: ['Dashboard', 'Open Dashboard Overview for a summary of your property, rooms, tenants, and collections.'],
    profile: ['Boarding House Profile', 'Open the property profile to update the details of your boarding house. Select the applicable branch where available.'],
    'my-profile': ['My Profile & Documents', 'Open My Profile to review your owner account and contact information.'],
    permit: ['Business Permit', 'Open the Permit section to check the status of your permit or submit a renewal request for your property.'],
    map: ['OpenStreetMap Location', 'Open Map Location to check the pin associated with your property.'],
    gallery: ['Gallery Management', 'Open the gallery to manage your property listing photos. Select the applicable branch before editing.'],
    amenities: ['Amenities', 'Open Amenities to manage the facilities shown on your property listing.'],
    rules: ['House Rules', 'Open House Rules to update the rules shown on your property listing.'],
    rooms: ['Room Management', 'Open Rooms, select your property or branch, and add or edit rooms. Check capacity and availability before saving.'],
    tenants: ['Tenant Management', 'Open Tenants to review applications and manage residents, room assignments, and recorded move-outs for your property.'],
    payments: ['Monthly Payments', 'Open Payments to review rent or reservation collections and verify tenant submissions for your property.'],
    inquiries: ['Clients & Inquiries', 'Open Inquiries to review messages of interest sent to your property and use the available actions.'],
    messages: ['Messaging', 'Open Messaging to view and reply to conversations with your tenants.'],
    maintenance: ['Maintenance Requests', 'Open Maintenance Requests to review and update maintenance requests submitted by your tenants.'],
    reports: ['Reports & Exports', 'Open Reports to view or export available reports for your property, including collection summaries.'],
    notifications: ['Activity', 'Open Activity to review notifications for your owner account.'],
    activity: ['Activity Logs', 'Open Activity Logs to review actions recorded for your owner account.'],
    settings: ['Settings', 'Open Settings to manage options available for your owner account.']
  }
};

const policies = new Map([
  ['super_admin', bplo],
  ['bplo_admin', bplo],
  ['barangay', barangay],
  ['boarding_house_owner', owner]
]);

export function dormigoPortalPolicy(accountType) {
  return policies.get(accountType);
}
