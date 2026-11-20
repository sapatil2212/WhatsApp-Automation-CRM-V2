import { clinicDirectoryController as c } from '@/server/controllers/clinic-directory.controller';

export const GET = c.getDoctor;
export const PATCH = c.updateDoctor;
export const DELETE = c.deleteDoctor;
