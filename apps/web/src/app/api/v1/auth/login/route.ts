import type {NextRequest} from "next/server";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const origin=new URL(process.env.APP_ORIGIN||"http://localhost:3100");
 const host=request.headers.get("host")?.toLowerCase();
 if(host&&host!==origin.host.toLowerCase())return new Response(null,{status:307,headers:{Location:new URL("/api/v1/auth/login",origin).toString(),"Cache-Control":"no-store"}});
 try{
  const upstream=await fetch((process.env.API_INTERNAL_URL||"http://localhost:4000")+"/api/v1/auth/login",{redirect:"manual",cache:"no-store"});
  const location=upstream.headers.get("location")||new URL("/?auth=failed",origin).toString();
  const response=new Response(null,{status:upstream.status>=300&&upstream.status<400?upstream.status:302,headers:{Location:location,"Cache-Control":"no-store"}});
  for(const cookie of upstream.headers.getSetCookie())response.headers.append("Set-Cookie",cookie);
  return response;
 }catch{return new Response(null,{status:302,headers:{Location:new URL("/?auth=failed",origin).toString(),"Cache-Control":"no-store"}});}
}
