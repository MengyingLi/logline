import type { NextAuthOptions } from 'next-auth';
import GitHub from 'next-auth/providers/github';

export const authOptions: NextAuthOptions = {
  providers: [
    GitHub({
      // Allow `next build` / CI without OAuth env; sign-in fails until configured.
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? 'placeholder-set-github-oauth-client-id',
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? 'placeholder-set-github-oauth-secret',
      authorization: {
        params: { scope: 'read:user read:org user:email' },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.accessToken) {
        (session as { accessToken?: string }).accessToken = token.accessToken as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/signin',
  },
};
