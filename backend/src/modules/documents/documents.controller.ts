import type { Request, Response } from 'express';
import { BadRequestError } from '../../lib/errors.js';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import {
  listDocumentsQuerySchema,
  toDocumentDto,
  updateDocumentSchema,
  uploadFieldsSchema,
} from './documents.schemas.js';
import type { DocumentsService } from './documents.service.js';

export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  upload = async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      throw new BadRequestError('No se recibió ningún archivo (campo "files")');
    }
    const fields = parseInput(uploadFieldsSchema, req.body);
    const outcomes = await this.service.upload(
      files.map((f) => ({ tempPath: f.path, originalName: f.originalname, sizeBytes: f.size })),
      fields,
    );
    const results = outcomes.map((outcome) =>
      outcome.status === 'rejected'
        ? outcome
        : { status: outcome.status, originalName: outcome.originalName, document: toDocumentDto(outcome.document) },
    );
    res.status(results.some((r) => r.status === 'created') ? 202 : 200).json({ results });
  };

  list = async (req: Request, res: Response) => {
    const filters = parseInput(listDocumentsQuerySchema, req.query);
    const documents = await this.service.list(filters);
    res.json({ documents: documents.map(toDocumentDto) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ document: toDocumentDto(await this.service.get(id)) });
  };

  downloadFile = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const file = await this.service.getFile(id);
    const asciiName = file.originalName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.type(file.mimeType);
    res.sendFile(file.absolutePath);
  };

  update = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const data = parseInput(updateDocumentSchema, req.body);
    res.json({ document: toDocumentDto(await this.service.update(id, data)) });
  };

  reprocess = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.status(202).json({ document: toDocumentDto(await this.service.reprocess(id)) });
  };

  delete = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.delete(id);
    res.status(204).end();
  };
}
