import {NextResponse} from "next/server";
export function proxy(){return NextResponse.next();}
export const config={matcher:["/api/v1/auth/login"]};
