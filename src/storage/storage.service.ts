import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

export type StorageBackend = 'local' | 's3' | 'db';

/**
 * Stockage des images de preuve, trois modes (STORAGE_BACKEND) :
 * - local : disque (développement, VM avec disque persistant) ;
 * - s3    : stockage compatible S3 (Cloudflare R2…) ;
 * - db    : table media_blobs de MySQL (hébergeurs au disque éphémère, ex. Render gratuit).
 * « auto » choisit s3 si STORAGE_ENDPOINT est défini, sinon local.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly localRoot: string;
  readonly backend: StorageBackend;

  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    const endpoint = config.get('STORAGE_ENDPOINT');
    const wanted = config.get('STORAGE_BACKEND') ?? 'auto';
    this.backend = wanted === 'auto' ? (endpoint ? 's3' : 'local') : wanted;
    this.localRoot = resolve(config.get('STORAGE_LOCAL_DIR'));

    if (this.backend === 's3') {
      const bucket = config.get('STORAGE_BUCKET');
      const accessKeyId = config.get('STORAGE_KEY');
      const secretAccessKey = config.get('STORAGE_SECRET');
      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error(
          'Stockage S3 : STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_KEY et STORAGE_SECRET sont obligatoires',
        );
      }
      this.bucket = bucket;
      this.s3 = new S3Client({
        endpoint,
        region: 'auto',
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    switch (this.backend) {
      case 's3':
        await this.s3!.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
          }),
        );
        return;
      case 'db':
        checkKey(key);
        {
          // Prisma 6 attend un Uint8Array sur un ArrayBuffer simple
          const bytes = new Uint8Array(data);
          await this.prisma.mediaBlob.upsert({
            where: { key },
            create: { key, mimeType: contentType, data: bytes },
            update: { mimeType: contentType, data: bytes },
          });
        }
        return;
      case 'local': {
        const path = this.localPath(key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, data);
      }
    }
  }

  async get(key: string): Promise<Buffer> {
    switch (this.backend) {
      case 's3': {
        const res = await this.s3!.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        return Buffer.from(await res.Body!.transformToByteArray());
      }
      case 'db': {
        const row = await this.prisma.mediaBlob.findUnique({
          where: { key },
          select: { data: true },
        });
        if (!row) throw new Error('Image introuvable');
        return Buffer.from(row.data);
      }
      case 'local':
        return readFile(this.localPath(key));
    }
  }

  async delete(key: string): Promise<void> {
    switch (this.backend) {
      case 's3':
        await this.s3!.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        return;
      case 'db':
        await this.prisma.mediaBlob.deleteMany({ where: { key } });
        return;
      case 'local':
        await rm(this.localPath(key), { force: true });
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      switch (this.backend) {
        case 's3':
          await this.s3!.send(new HeadBucketCommand({ Bucket: this.bucket }));
          break;
        case 'db':
          await this.prisma.mediaBlob.count({ take: 1 });
          break;
        case 'local':
          await mkdir(this.localRoot, { recursive: true });
          await access(this.localRoot);
      }
      return true;
    } catch (err) {
      this.logger.warn(`Stockage indisponible : ${(err as Error).name}`);
      return false;
    }
  }

  /** Empêche toute clé de sortir du dossier racine (../). */
  private localPath(key: string): string {
    checkKey(key);
    const path = resolve(join(this.localRoot, key));
    if (!path.startsWith(this.localRoot + sep)) {
      throw new Error('Clé de stockage invalide');
    }
    return path;
  }
}

function checkKey(key: string): void {
  if (!key || key.length > 255 || key.includes('..') || key.startsWith('/')) {
    throw new Error('Clé de stockage invalide');
  }
}
