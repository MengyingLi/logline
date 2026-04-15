const supabase = {
  from: (table: string) => ({
    insert: (_values: unknown) => Promise.resolve({}),
  }),
};

export { supabase };

