import { clinicDirectoryController as c } from '@/server/controllers/clinic-directory.controller';

export const GET = c.listDepartments;
export const POST = c.createDepartment;
