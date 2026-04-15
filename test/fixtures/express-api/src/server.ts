type Request = { body?: Record<string, unknown>; params?: Record<string, string> };
type Response = { status: (code: number) => Response; json: (payload: unknown) => void };

const app = {
  post: (_route: string, _handler: (req: Request, res: Response) => Promise<void> | void) => {},
  patch: (_route: string, _handler: (req: Request, res: Response) => Promise<void> | void) => {},
  delete: (_route: string, _handler: (req: Request, res: Response) => Promise<void> | void) => {},
};

const prisma = {
  workflow: {
    create: async (_args: unknown) => ({}),
    update: async (_args: unknown) => ({}),
    delete: async (_args: unknown) => ({}),
  },
};

app.post('/api/workflows', async (req, res) => {
  await prisma.workflow.create({ data: req.body });
  res.status(201).json({ ok: true });
});

app.patch('/api/workflows/:id', async (req, res) => {
  await prisma.workflow.update({ where: { id: req.params?.id }, data: req.body });
  res.status(200).json({ ok: true });
});

app.delete('/api/workflows/:id', async (req, res) => {
  await prisma.workflow.delete({ where: { id: req.params?.id } });
  res.status(204).json({ ok: true });
});

