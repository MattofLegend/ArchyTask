export type ItemType = 'todo' | 'heading';

export abstract class Item {
    public id: string;
    public indent: number;
    public title: string;
    public index: number;
    public abstract type: ItemType;
    public note: string = "";

    constructor(indent: number, title: string, index: number) {
        this.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        this.indent = indent;
        this.title = title;
        this.index = index;
    }
}

export class ItemTodo extends Item {
    public type: ItemType = 'todo';
    public isChecked: boolean;

    constructor(indent: number, title: string, index: number, isChecked: boolean = false) {
        super(indent, title, index);
        this.isChecked = isChecked;
    }
}

export class ItemHeading extends Item {
    public type: ItemType = 'heading';

    constructor(title: string, index: number) {
        super(0, title, index); // Headings are always indent 0
    }
}
