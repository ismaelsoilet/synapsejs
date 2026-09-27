import { describe, expect, test } from 'bun:test';
import { compileSelect, type JoinClause, nestJoinedRow, SqliteDatabaseClient } from '../src/core';

describe('Query Builder - Joins & Relational Projections', () => {
  test('compileSelect compiles LEFT JOIN with alias and qualified ON', () => {
    const { sql, params } = compileSelect('orders', {
      select: ['id', 'total'],
      join: [
        {
          table: 'customers',
          as: 'c',
          type: 'LEFT',
          on: { customer_id: 'c.id' },
          select: ['name', 'email']
        }
      ],
      where: { 'orders.total': 150 },
      orderBy: { 'orders.created_at': 'desc' }
    });

    expect(sql).toBe(
      'SELECT orders.id AS "id", orders.total AS "total", c.name AS "c_name", c.email AS "c_email" FROM orders LEFT JOIN customers AS c ON orders.customer_id = c.id WHERE orders.total = $1 ORDER BY orders.created_at DESC'
    );
    expect(params).toEqual([150]);
  });

  test('compileSelect handles multiple joins (INNER + LEFT)', () => {
    const { sql, params } = compileSelect('tickets', {
      join: [
        {
          table: 'agents',
          type: 'INNER',
          on: { assigned_to: 'agents.id' },
          select: ['name']
        },
        {
          table: 'departments',
          as: 'dept',
          type: 'LEFT',
          on: { department_id: 'dept.id' },
          select: ['title']
        }
      ]
    });

    expect(sql).toBe(
      'SELECT tickets.*, agents.name AS "agents_name", dept.title AS "dept_title" FROM tickets INNER JOIN agents ON tickets.assigned_to = agents.id LEFT JOIN departments AS dept ON tickets.department_id = dept.id'
    );
    expect(params).toEqual([]);
  });

  test('nestJoinedRow nests prefixed fields into sub-objects', () => {
    const flatRow = {
      id: 'ord_1',
      total: 99.9,
      c_name: 'Alice',
      c_email: 'alice@example.com'
    };

    const joins: JoinClause[] = [
      {
        table: 'customers',
        as: 'c',
        on: { customer_id: 'c.id' },
        select: ['name', 'email']
      }
    ];

    interface NestedOrder {
      id: string;
      total: number;
      c: {
        name: string;
        email: string;
      };
    }

    const nested = nestJoinedRow<NestedOrder>(flatRow, joins);
    expect(nested.id).toBe('ord_1');
    expect(nested.total).toBe(99.9);
    expect(nested.c).toEqual({
      name: 'Alice',
      email: 'alice@example.com'
    });
  });

  test('SqliteDatabaseClient executes findMany and findOne with real JOIN and row nesting', async () => {
    const db = new SqliteDatabaseClient(':memory:');
    db.initSchema(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      INSERT INTO users (id, name) VALUES ('u_1', 'John Doe');
      INSERT INTO users (id, name) VALUES ('u_2', 'Jane Smith');

      INSERT INTO posts (id, user_id, title) VALUES ('p_1', 'u_1', 'First Post');
      INSERT INTO posts (id, user_id, title) VALUES ('p_2', 'u_1', 'Second Post');
      INSERT INTO posts (id, user_id, title) VALUES ('p_3', 'u_2', 'Hello World');
    `);

    interface PostWithAuthor {
      id: string;
      title: string;
      author_name?: string;
      author: {
        name: string;
      };
    }

    const posts = await db.findMany<PostWithAuthor>('posts', {
      select: ['id', 'title'],
      join: [
        {
          table: 'users',
          as: 'author',
          type: 'INNER',
          on: { user_id: 'author.id' },
          select: ['name']
        }
      ],
      where: { 'posts.user_id': 'u_1' },
      orderBy: { 'posts.id': 'asc' }
    });

    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual({
      id: 'p_1',
      title: 'First Post',
      author_name: 'John Doe',
      author: {
        name: 'John Doe'
      }
    });
    expect(posts[1].author.name).toBe('John Doe');

    const singlePost = await db.findOne<PostWithAuthor>('posts', {
      select: ['id', 'title'],
      join: [
        {
          table: 'users',
          as: 'author',
          type: 'INNER',
          on: { user_id: 'author.id' },
          select: ['name']
        }
      ],
      where: { 'posts.id': 'p_3' }
    });

    expect(singlePost).not.toBeNull();
    expect(singlePost?.title).toBe('Hello World');
    expect(singlePost?.author.name).toBe('Jane Smith');
  });
});
